#!/bin/bash
# deliver.sh <creature_dir> <key> <out_dir> <Clip,Clip,...> [head_dist]
# Ships the final build (final/<key>_raw.glb + final/<key>.blend): optimized KTX2 GLB, raw GLB,
# .blend, maps, Cycles renders beside the knight, clip sheets, MP4s and the gate logs.
C=$1; KEY=$2; O=$3; CLIPS=$4; HD=${5:-1.0}
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
K=${KIT:-$(cd "$(dirname "$0")" && pwd)}
FF=${FFMPEG:-$K/../../../../node_modules/ffmpeg-static/ffmpeg.exe}
KN=${KNIGHT:?set KNIGHT to the scale knight GLB}
F=${6:-$C/final}
BL=$F/$KEY.blend
BU=$C/builder
mkdir -p $O/modelo $O/glb $O/texturas $O/renders $O/hojas_de_clips $O/videos $O/checks $F/_frames
cd $K
echo "== ship"
KTX_BIN=${KTX_BIN:?set KTX_BIN to the KTX-Software bin} node ship.mjs $F/${KEY}_raw.glb $O/glb/$KEY.glb | tail -1
cp $F/${KEY}_raw.glb $O/glb/${KEY}_raw.glb
cp $BL $O/modelo/
cp $F/tex/*_2048.png $F/tex/*_1024.png $O/texturas/ 2>/dev/null
cp $F/stats.json $O/ 2>/dev/null
echo "== checks"
"$B" -b $BL --python review.py -- $F/_frames checks --builder $BU 2>/dev/null | grep -E "CHECK" > $O/checks/checks.txt
"$B" -b $BL --python review.py -- $F/_frames analyze --builder $BU 2>/dev/null | grep -E "ANALYZE" > $O/checks/analyze.txt
cat $O/checks/checks.txt | tail -1
echo "== renders"
"$B" -b $BL --python review.py -- $O/renders views --builder $BU --knight $KN +cycles --samples 64 --w 1600 --h 1200 > /dev/null 2>&1
"$B" -b $BL --python review.py -- $O/renders closeup --builder $BU --hd $HD +cycles --samples 64 --w 1200 --h 1200 > /dev/null 2>&1
echo "== sheets"
"$B" -b $BL --python review.py -- $F/_frames/sheet sheet $CLIPS 8 --prefix $KEY --builder $BU --knight $KN --w 640 --h 560 > /dev/null 2>&1
node sheet.mjs $F/_frames/sheet $KEY $O/hojas_de_clips --cols 4 --cell 480 --all $O/hojas_de_clips/todas_las_animaciones.jpg | tail -1
echo "== videos"
for CL in ${CLIPS//,/ }; do
  rm -rf $F/_frames/v_$CL; mkdir -p $F/_frames/v_$CL
  "$B" -b $BL --python review.py -- $F/_frames/v_$CL video $CL --builder $BU --knight $KN --w 960 --h 720 > /dev/null 2>&1
  "$FF" -y -loglevel error -framerate 24 -i $F/_frames/v_$CL/${CL}_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 $O/videos/$CL.mp4 && echo "  $CL"
done
echo "== done"
