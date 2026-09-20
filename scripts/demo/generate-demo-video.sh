#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
asset_dir="$project_root/public/demo-assets"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

render_scene() {
  local output="$1"
  local chapter="$2"
  local eyebrow="$3"
  local title="$4"
  local body="$5"
  local symbol="$6"
  local row_one="$7"
  local row_two="$8"
  local row_three="$9"
  local progress=$((chapter * 112))
  local grid_lines=""
  local x
  local y
  for x in $(seq 0 64 1280); do grid_lines+="line ${x},64 ${x},720 "; done
  for y in $(seq 64 64 720); do grid_lines+="line 0,${y} 1280,${y} "; done

  convert -size 1280x720 "gradient:#071316-#16322f" \
    -stroke "#62cadb18" -strokewidth 1 -draw "$grid_lines" \
    -fill "#050e11cc" -stroke "#62cadb55" -strokewidth 2 \
    -draw "roundrectangle 730,112 1202,584 18,18" \
    -fill "#ffd85f" -stroke none -draw "polygon 1140,0 1280,0 1280,104 1248,104" \
    -fill "#62cadb" -font DejaVu-Sans-Mono -pointsize 17 \
    -annotate +70+43 "CHESSRIOT  /  90-SECOND TOUR" \
    -fill "#9ab8ba" -pointsize 13 -annotate +1074+43 "STORY v4" \
    -fill "#62cadb" -pointsize 15 -annotate +70+132 "$eyebrow" \
    -fill "#f7f1d6" -font DejaVu-Sans -pointsize 58 \
    -annotate +66+208 "$title" \
    -fill "#b8cac8" -pointsize 23 -interline-spacing 7 \
    -annotate +70+466 "$body" \
    -fill "#ffd85f" -font DejaVu-Sans -pointsize 82 \
    -gravity NorthEast -annotate +188+150 "$symbol" -gravity NorthWest \
    -fill "#10282d" -stroke "#29494c" -strokewidth 1 \
    -draw "roundrectangle 770,354 1160,408 10,10 roundrectangle 770,425 1160,479 10,10 roundrectangle 770,496 1160,550 10,10" \
    -fill "#62cadb" -stroke none \
    -draw "roundrectangle 788,370 810,392 4,4 roundrectangle 788,441 810,463 4,4 roundrectangle 788,512 810,534 4,4" \
    -fill "#f7f1d6" -font DejaVu-Sans-Mono -pointsize 17 \
    -annotate +830+388 "$row_one" -annotate +830+459 "$row_two" -annotate +830+530 "$row_three" \
    -fill "#9ab8ba" -pointsize 13 -annotate +70+678 "CHAPTER $(printf '%02d' "$chapter") / 09" \
    -fill "#17373a" -draw "roundrectangle 252,666 1160,674 4,4" \
    -fill "#ffd85f" -draw "roundrectangle 252,666 $((252 + progress)),674 4,4" \
    -quality 91 "$output"
}

render_scene "$asset_dir/home.jpg" 1 "CHESS, BUT ALIVE" \
  $'REAL CHESS.\nTOTAL PLAY.' \
  $'See the product before login.\nThen keep every move, on every device.' \
  "♞" "GOOGLE ACCOUNT REQUIRED" "NO GUEST MODE" "ONE GAME, STILL MOVING"

render_scene "$asset_dir/onboarding.jpg" 2 "START IN UNDER A MINUTE" \
  $'SIGN IN.\nCLAIM YOUR NAME.' \
  $'Choose one permanent username.\nLearn the essentials in 45 seconds — or skip.' \
  "◎" "PERMANENT USERNAME" "SKIPPABLE TUTORIAL" "PIECES · MOVES · ACTIVITY"

render_scene "$asset_dir/dashboard.jpg" 3 "YOUR SIGNED-IN HOME" \
  $'KNOW WHAT\nNEEDS YOU.' \
  $'Continue a game, answer a request,\nor see whose turn it is at a glance.' \
  "◆" "ACTIVITY INBOX" "FIVE RIOT BOT LEVELS" "FRIENDS & CHALLENGES"

render_scene "$asset_dir/themes.jpg" 4 "EVERY SKIN HAS A VOICE" \
  $'LOOK. SOUND.\nATMOSPHERE.' \
  $'Boards, pieces, effects, and richer music\nstay distinctive from one skin to the next.' \
  "✦" "CLASSIC · OCEAN · MYTHIC" "UNIQUE PIECES & EFFECTS" "SEPARATE MUSIC CONTROL"

render_scene "$asset_dir/challenge.jpg" 5 "PLAY SOMEONE YOU KNOW" \
  $'FIND. FRIEND.\nCHALLENGE.' \
  $'Search by username, choose variant and pace,\nthen send a direct game challenge.' \
  "↗" "FRIEND REQUEST" "CHOOSE VARIANT & PACE" "DIRECT CHALLENGE"

render_scene "$asset_dir/activity.jpg" 6 "ONE QUIET INBOX" \
  $'REQUESTS TO\nRESULTS.' \
  $'Friend requests, challenges, turns,\nand finished games stay together.' \
  "●" "UNREAD ACTIVITY" "ANSWER IN PLACE" "BLOCK & REPORT CONTROLS"

render_scene "$asset_dir/game.jpg" 7 "THE BOARD OWNS THE SCREEN" \
  $'ONE SCREEN.\nEVERY MOVE.' \
  $'Two live clocks, status, deadline, and controls.\nDrag, tap, click, or use the keyboard.' \
  "♜" "LEGAL MOVES CHECKED" "CLEAR GAME MOMENTS" "EVERY MOVE SAVED"

render_scene "$asset_dir/history-privacy.jpg" 8 "LEAVE. RETURN. CONTINUE." \
  $'NOTHING\nGETS LOST.' \
  $'Resume the exact position. Replay History.\nDownload data, manage blocks, or delete safely.' \
  "↺" "FULL GAME HISTORY" "PRIVACY & DATA CENTER" "GOOGLE-VERIFIED DELETION"

render_scene "$asset_dir/magic.jpg" 9 "SERVER-CONTROLLED EARLY ACCESS" \
  $'MAGIC RULES\nARE BREWING.' \
  $'Coming Soon for most players.\nEnabled only for invited testers.' \
  "✧" "FEATURE-FLAGGED" "ADMIN WHITELIST" "CHESSRIOT"

convert "$asset_dir/home.jpg" -quality 89 "$asset_dir/poster.jpg"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "flite=textfile=$project_root/scripts/demo/narration.txt:voice=slt" \
  -af "atempo=0.945,adelay=500,apad=whole_dur=90s,afade=t=in:st=0:d=0.25,afade=t=out:st=89.2:d=0.6" \
  -t 90 -ar 48000 -ac 1 -codec:a libmp3lame -b:a 160k \
  "$asset_dir/fallback-narration.mp3"

ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "sine=frequency=55:sample_rate=48000:duration=90" \
  -f lavfi -i "sine=frequency=82.41:sample_rate=48000:duration=90" \
  -f lavfi -i "sine=frequency=164.81:sample_rate=48000:duration=90" \
  -f lavfi -i "anoisesrc=color=pink:amplitude=0.02:sample_rate=48000:duration=90" \
  -filter_complex "\
    [0:a]volume=0.07,tremolo=f=0.12:d=0.45,lowpass=f=380[a0];\
    [1:a]volume=0.045,tremolo=f=0.19:d=0.62,aecho=0.7:0.25:650:0.25,lowpass=f=700[a1];\
    [2:a]volume=0.018,tremolo=f=0.31:d=0.78,aecho=0.7:0.18:900:0.18,lowpass=f=1400[a2];\
    [3:a]highpass=f=90,lowpass=f=1600,volume=0.18[a3];\
    [a0][a1][a2][a3]amix=inputs=4:duration=longest,\
    acompressor=threshold=0.08:ratio=3:attack=25:release=400,\
    afade=t=in:st=0:d=2,afade=t=out:st=87:d=3[bed]" \
  -map "[bed]" -ar 48000 -ac 2 -codec:a libmp3lame -b:a 160k \
  "$asset_dir/demo-bed.mp3"

ffmpeg -y -hide_banner -loglevel error \
  -framerate 30 -loop 1 -t 9.5 -i "$asset_dir/home.jpg" \
  -framerate 30 -loop 1 -t 14.5 -i "$asset_dir/onboarding.jpg" \
  -framerate 30 -loop 1 -t 10 -i "$asset_dir/dashboard.jpg" \
  -framerate 30 -loop 1 -t 9 -i "$asset_dir/themes.jpg" \
  -framerate 30 -loop 1 -t 10.5 -i "$asset_dir/challenge.jpg" \
  -framerate 30 -loop 1 -t 5 -i "$asset_dir/activity.jpg" \
  -framerate 30 -loop 1 -t 19.5 -i "$asset_dir/game.jpg" \
  -framerate 30 -loop 1 -t 8 -i "$asset_dir/history-privacy.jpg" \
  -framerate 30 -loop 1 -t 4 -i "$asset_dir/magic.jpg" \
  -i "$asset_dir/fallback-narration.mp3" \
  -i "$asset_dir/demo-bed.mp3" \
  -filter_complex "\
    [0:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=9.1:d=0.4,setsar=1[v0];\
    [1:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=14.1:d=0.4,setsar=1[v1];\
    [2:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=9.6:d=0.4,setsar=1[v2];\
    [3:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=8.6:d=0.4,setsar=1[v3];\
    [4:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=10.1:d=0.4,setsar=1[v4];\
    [5:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=4.6:d=0.4,setsar=1[v5];\
    [6:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=19.1:d=0.4,setsar=1[v6];\
    [7:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,fade=t=out:st=7.6:d=0.4,setsar=1[v7];\
    [8:v]zoompan=z='min(zoom+0.00010,1.035)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=30,fade=t=in:st=0:d=0.35,setsar=1[v8];\
    [v0][v1][v2][v3][v4][v5][v6][v7][v8]concat=n=9:v=1:a=0[rawvideo];\
    [rawvideo]format=yuv420p[video];\
    [9:a]volume=1.16[narration];[10:a]volume=0.22[bed];\
    [narration][bed]amix=inputs=2:duration=longest:dropout_transition=2,\
    loudnorm=I=-16:TP=-1.5:LRA=9[audio]" \
  -map "[video]" -map "[audio]" \
  -t 90 -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -movflags +faststart \
  "$asset_dir/chessriot-demo.mp4"

node "$project_root/scripts/demo/write-fallback-manifest.mjs"

ffprobe -v error \
  -show_entries format=duration:stream=codec_type,codec_name,width,height \
  -of json "$asset_dir/chessriot-demo.mp4"
