# Synthetic video fixtures

No personal footage. Generated from FFmpeg testsrc and a 440Hz sine wave:

```sh
ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 -c:v libx264 -preset medium -crf 32 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart synthetic.mp4
ffmpeg -display_rotation 90 -i synthetic.mp4 -c copy rotated.mov
ffmpeg -i synthetic.mp4 -c:v libx265 -preset fast -crf 32 -x265-params pools=1:frame-threads=1:log-level=error -tag:v hvc1 -c:a copy hevc.mov
```

`rotated.mov` has a 90 degree display matrix and tests baked portrait orientation.
The integration suite adds a legal MP4 free atom to exercise resumable multipart
transfer while retaining this same synthetic recording.
