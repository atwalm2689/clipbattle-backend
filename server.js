const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for Netlify and all origins
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'ClipBattle API is running!' });
});

// Handle CORS preflight requests
app.options('/create', cors());

// Helper function to get video duration
function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) reject(err);
      else resolve(metadata.format.duration);
    });
  });
}

// Video processing endpoint
app.post('/create', upload.fields([
  { name: 'video1', maxCount: 1 },
  { name: 'video2', maxCount: 1 }
]), async (req, res) => {
  try {
    const video1 = req.files.video1[0];
    const video2 = req.files.video2[0];

    const outputFilename = `clipbattle_${Date.now()}.mp4`;
    const outputPath = path.join('uploads', outputFilename);

    console.log('Processing videos:', video1.originalname, video2.originalname);

    console.log('Processing videos:', video1.originalname, video2.originalname);

    // Get video durations first
    const duration1 = await getVideoDuration(video1.path);
    const duration2 = await getVideoDuration(video2.path);

    console.log('Video 1 duration:', duration1, 'Video 2 duration:', duration2);

    // Process videos with FFmpeg
    // Create split-screen where:
    // - Phase 1: top video plays, bottom shows grayed first frame
    // - Phase 2: top shows grayed last frame, bottom video plays
    
    ffmpeg()
      .input(video1.path)
      .input(video2.path)
      .complexFilter([
        // Scale both videos and split them
        '[0:v]scale=1080:960:force_original_aspect_ratio=decrease,pad=1080:960:(ow-iw)/2:(oh-ih)/2,setsar=1,split=2[v0][v0copy]',
        '[1:v]scale=1080:960:force_original_aspect_ratio=decrease,pad=1080:960:(ow-iw)/2:(oh-ih)/2,setsar=1,split=2[v1][v1copy]',
        
        // Create grayed out still frame from video 2 first frame (for bottom during video 1)
        '[v1copy]trim=end_frame=1,loop=loop=-1:size=1,colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3:0,eq=brightness=-0.3,trim=duration=' + duration1 + ',setpts=PTS-STARTPTS[v1gray]',
        
        // Create grayed out still frame from video 1 last frame (for top during video 2)
        '[v0copy]reverse,trim=end_frame=1,loop=loop=-1:size=1,colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3:0,eq=brightness=-0.3,trim=duration=' + duration2 + ',setpts=PTS-STARTPTS[v0gray]',
        
        // Stack for phase 1 (top playing, bottom grayed)
        '[v0][v1gray]vstack=inputs=2[phase1]',
        
        // Stack for phase 2 (top grayed, bottom playing)  
        '[v0gray][v1]vstack=inputs=2[phase2]',
        
        // Concatenate both phases
        '[phase1][0:a][phase2][1:a]concat=n=2:v=1:a=1[outv][outa]'
      ])
      .outputOptions([
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '28',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-s', '1080x1920',
        '-r', '30',
        '-movflags', '+faststart'
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg command:', commandLine);
      })
      .on('progress', (progress) => {
        console.log('Processing: ' + Math.round(progress.percent) + '% done');
      })
      .on('end', () => {
        console.log('Processing finished successfully');
        
        // Send the file
        res.download(outputPath, outputFilename, (err) => {
          // Cleanup files after sending
          fs.unlinkSync(video1.path);
          fs.unlinkSync(video2.path);
          fs.unlinkSync(outputPath);
          
          if (err) {
            console.error('Error sending file:', err);
          }
        });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        
        // Cleanup on error
        try {
          fs.unlinkSync(video1.path);
          fs.unlinkSync(video2.path);
          if (fs.existsSync(outputPath)) {
            fs.unlinkSync(outputPath);
          }
        } catch (cleanupErr) {
          console.error('Cleanup error:', cleanupErr);
        }
        
        res.status(500).json({ 
          error: 'Video processing failed',
          details: err.message 
        });
      })
      .run();

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`ClipBattle API running on port ${PORT}`);
});
