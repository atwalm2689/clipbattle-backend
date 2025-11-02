const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all origins
app.use(cors());
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

    // Process videos with FFmpeg
    // 1. Scale each video to 1080x960 (9:16 aspect ratio, half height)
    // 2. Stack them vertically
    // 3. Play sequentially (concat)
    
    ffmpeg()
      .input(video1.path)
      .input(video2.path)
      .complexFilter([
        // Scale both videos to 1080x960 (half of 1080x1920)
        '[0:v]scale=1080:960:force_original_aspect_ratio=decrease,pad=1080:960:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]',
        '[1:v]scale=1080:960:force_original_aspect_ratio=decrease,pad=1080:960:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]',
        // Concatenate videos
        '[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[outv][outa]'
      ])
      .outputOptions([
        '-map', '[outv]',
        '-map', '[outa]',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-s', '1080x1920', // Final 9:16 resolution
        '-r', '30'
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
