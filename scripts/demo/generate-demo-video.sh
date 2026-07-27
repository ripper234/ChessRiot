#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
asset_dir="$project_root/public/demo-assets"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "flite=textfile=$project_root/scripts/demo/narration.txt:voice=slt" \
  -af "atempo=0.72,adelay=500,apad=whole_dur=90s" \
  -t 90 -ar 48000 -ac 1 -codec:a libmp3lame -b:a 128k \
  "$asset_dir/fallback-narration.mp3"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=55:sample_rate=48000:duration=90" \
  -f lavfi -i "sine=frequency=82.41:sample_rate=48000:duration=90" \
  -filter_complex "\
    [0:a]volume=0.04,tremolo=f=0.25:d=0.65,lowpass=f=800[a0];\
    [1:a]volume=0.025,tremolo=f=0.166:d=0.75,lowpass=f=1000[a1];\
    [a0][a1]amix=inputs=2:duration=longest,\
    afade=t=in:st=0:d=2,afade=t=out:st=87:d=3[bed]" \
  -map "[bed]" -ar 48000 -ac 2 -codec:a libmp3lame -b:a 128k \
  "$asset_dir/demo-bed.mp3"

ffmpeg -y -hide_banner -loglevel error \
  -framerate 30 -loop 1 -t 14.5 -i "$asset_dir/home.jpg" \
  -framerate 30 -loop 1 -t 4.5 -i "$asset_dir/solo.jpg" \
  -framerate 30 -loop 1 -t 11 -i "$asset_dir/game.jpg" \
  -framerate 30 -loop 1 -t 9 -i "$asset_dir/themes.jpg" \
  -framerate 30 -loop 1 -t 12 -i "$asset_dir/multiplayer.jpg" \
  -framerate 30 -loop 1 -t 5.5 -i "$asset_dir/invite-safe.jpg" \
  -framerate 30 -loop 1 -t 10.5 -i "$asset_dir/invite-safe.jpg" \
  -framerate 30 -loop 1 -t 16 -i "$asset_dir/game.jpg" \
  -framerate 30 -loop 1 -t 7 -i "$asset_dir/home.jpg" \
  -i "$asset_dir/fallback-narration.mp3" \
  -i "$asset_dir/demo-bed.mp3" \
  -filter_complex "\
    [0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v0];\
    [1:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v1];\
    [2:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v2];\
    [3:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v3];\
    [4:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v4];\
    [5:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v5];\
    [6:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v6];\
    [7:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v7];\
    [8:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,zoompan=z='min(zoom+0.00012,1.03)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,setsar=1[v8];\
    [v0][v1][v2][v3][v4][v5][v6][v7][v8]concat=n=9:v=1:a=0[rawvideo];\
    [rawvideo]drawbox=x=0:y=0:w=iw:h=64:color=0x071019@0.9:t=fill,\
    drawtext=font='DejaVu Sans':text='CHESSRIOT  |  ONE GAME, STILL MOVING':x=32:y=21:fontsize=18:fontcolor=0x63c8dd,\
    subtitles='$asset_dir/captions.vtt':force_style='FontName=DejaVu Sans,FontSize=18,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&HCC071019,BorderStyle=3,BackColour=&H90071019,Outline=1,Shadow=0,MarginV=24,Alignment=2'[video];\
    [9:a]volume=1[narration];[10:a]volume=0.15[bed];\
    [narration][bed]amix=inputs=2:duration=longest:dropout_transition=2[audio]" \
  -map "[video]" -map "[audio]" \
  -t 90 -c:v libx264 -preset medium -crf 21 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart \
  "$asset_dir/chessriot-demo.mp4"

ffprobe -v error \
  -show_entries format=duration:stream=codec_type,codec_name,width,height \
  -of json "$asset_dir/chessriot-demo.mp4"
