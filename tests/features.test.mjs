import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmXml, flattenAll, elasticEase, SUPPORTED_EFFECTS } from '../lib/am-xml.ts';
import { evalLayer, layerIndex, hitTest, videoTimeSec, mul, invert, apply } from '../lib/scene-eval.ts';
import { collectAudioSources } from '../lib/audio-engine.ts';

const xml = `<?xml version='1.0'?>
<scene title="T" width="1080" height="1920" fps="60" totalTime="5000" bgcolor="#ff101010">
  <media uri="am:abc.mp4" filename="abc.mp4" title="Glicht" type="video/mp4" width="1280" height="720" duration="10033300" />
  <shape id="1" label="vid.mp4" startTime="0" endTime="4000" fillType="media" fillVideo="content://media/external/video/media/9" inTime="1000" outTime="3000" speed="2" hidden="true" s=".rect">
    <transform><location value="540,960,0" /></transform>
    <property name="size" type="vec2" value="540,960" />
  </shape>
  <shape id="2" label="foto" startTime="0" endTime="5000" fillType="media" fillImage="content://media/external/images/media/1" s=".rect">
    <transform><location value="540,960,0" /></transform>
    <property name="size" type="vec2" value="540,960" />
  </shape>
  <nullobj id="9" startTime="0" endTime="5000">
    <transform>
      <location value="540,960,0" />
      <scale><kf t="0" v="1,1" /><kf t="1" v="2,2" /></scale>
    </transform>
  </nullobj>
  <shape id="3" label="anak" parent="9" startTime="0" endTime="5000" fillType="color" s=".rect">
    <transform><location value="740,960,0" /></transform>
    <property name="size" type="vec2" value="100,100" />
    <fillColor value="#ffff0000" />
  </shape>
  <shape id="4" label="osc" startTime="0" endTime="4000" fillType="color" s=".rect">
    <transform><location value="100,100,0" /></transform>
    <property name="size" type="vec2" value="50,50" />
    <effect id="com.alightcreative.effects.oscillate3"><property name="angle" type="float" value="0" /><property name="freq" type="float" value="1" /><property name="mag" type="float" value="10" /><property name="phase" type="float" value="0" /><property name="type" type="int" value="0" /></effect>
    <effect id="com.alightcreative.effects.fade"><property name="inTime" type="float" value="1" /><property name="outTime" type="float" value="1" /></effect>
  </shape>
  <shape id="5" label="ela" startTime="0" endTime="1000" fillType="color" s=".rect">
    <transform><scale><kf t="0" v="1,1" /><kf t="1" v="2,2" e="reverse elastic 0.36939573 1.0 0.0 1.0" /></scale></transform>
    <property name="size" type="vec2" value="10,10" />
  </shape>
  <embedScene id="6" startTime="1000" endTime="2000" fillType="intrinsic">
    <transform><location value="540,960,0" /></transform>
    <shadow direction="outside"><size value="37" /></shadow>
    <scene width="1080" height="1920" totalTime="1000" fps="60">
      <shape id="61" startTime="0" endTime="1000" fillType="color" s=".circle"><transform><location value="500,500,0" /></transform><property name="size" type="vec2" value="80,80" /></shape>
    </scene>
  </embedScene>
</scene>`;

const scene = parseAmXml(xml);
const all = flattenAll(scene.layers);
const byId = (id) => all.find((l) => l.id === id);

test('video: rujukan dari fillVideo, bertipe video, hidden & in/out/speed terbaca', () => {
  const v = byId('1');
  assert.equal(v.type, 'video');
  assert.equal(v.mediaRef, 'content://media/external/video/media/9');
  assert.equal(v.visible, false);
  assert.equal(v.hiddenInSource, true);
  assert.equal(v.inTime, 1000);
  assert.equal(v.speed, 2);
  assert.ok(scene.warnings.some((w) => w.includes('disembunyikan')));
});

test('<media> dicatat sebagai registri; layer foto tetap bertipe image', () => {
  assert.equal(scene.mediaInfo['am:abc.mp4'].title, 'Glicht');
  assert.equal(scene.mediaInfo['am:abc.mp4'].width, 1280);
  assert.equal(byId('2').type, 'image');
});

test('nullobj → tipe null, dan parent terbaca', () => {
  assert.equal(byId('9').type, 'null');
  assert.equal(byId('3').parent, '9');
});

test('parent: transform induk berlaku di sekitar titik tengah induk', () => {
  const idx = layerIndex(scene.layers);
  const child = byId('3');
  const at0 = evalLayer(child, 0, idx);
  assert.deepEqual(apply(at0.m, 0, 0).map(Math.round), [740, 960]); // skala induk 1× → tidak bergeser
  const at5 = evalLayer(child, 5000, idx);
  // induk berskala 2× di sekitar (540,960): anak di x=740 → 540 + 200×2 = 940
  assert.deepEqual(apply(at5.m, 0, 0).map(Math.round), [940, 960]);
  assert.equal(at5.sx, 1); // skala anak sendiri tidak berubah
});

test('oscillate menggeser posisi sepanjang sudut; fade mengatur opacity', () => {
  const idx = layerIndex(scene.layers);
  const l = byId('4');
  const quarter = evalLayer(l, 250, idx); // freq 1Hz → t=0.25s → sin(π/2)=1 → +mag
  assert.ok(Math.abs(quarter.x - 110) < 0.01, `x=${quarter.x}`);
  assert.ok(Math.abs(quarter.y - 100) < 0.01);
  assert.ok(Math.abs(evalLayer(l, 500, idx).opacity - 0.5) < 1e-6); // fade-in 1 dtk
  assert.equal(evalLayer(l, 2000, idx).opacity, 1);
  assert.ok(Math.abs(evalLayer(l, 3500, idx).opacity - 0.5) < 1e-6); // fade-out 1 dtk sebelum 4 dtk
});

test('easing elastic dibaca dan dievaluasi (terbatas di ujung, tidak linear)', () => {
  const kf = byId('5').keyframes.scale[1];
  assert.equal(kf.ease.kind, 'elastic');
  assert.equal(kf.ease.reverse, true);
  assert.equal(elasticEase(0, true, 0.37), 0);
  assert.ok(Math.abs(elasticEase(1, true, 0.37) - 1) < 1e-9);
  assert.notEqual(elasticEase(0.5, true, 0.37).toFixed(3), '0.500');
});

test('embedScene: scene bersarang diparse, shadow dibaca, ukuran layer = ukuran scene', () => {
  const e = byId('6');
  assert.equal(e.type, 'scene');
  assert.equal(e.embed.layers.length, 1);
  assert.equal(e.embed.layers[0].shape, 'circle');
  assert.equal(e.shadow.size, 37);
  assert.equal(e.width, 1080);
});

test('waktu video: inTime + (t − start) × speed', () => {
  assert.equal(videoTimeSec(byId('1'), 500), (1000 + 500 * 2) / 1000);
});

test('hit-test mengikuti transform parent', () => {
  // di t=5000 anak ada di x=940 (lihat tes parent); ukuran 100×100 diskalakan induk 2× → 200×200
  assert.equal(hitTest(scene, 5000, 940, 960)?.id, '3');
  assert.equal(hitTest(scene, 5000, 740, 960)?.id !== '3', true);
});

test('matriks: invert × m = identitas', () => {
  const m = [2, 0.5, -0.3, 1.5, 10, -4];
  const inv = invert(m);
  const id = mul(m, inv).map((x) => Math.round(x * 1e9) / 1e9 + 0);
  assert.deepEqual(id, [1, 0, 0, 1, 0, 0]);
});

test('audio: hanya sumber yang punya file; track pengguna ikut', () => {
  const sc = { ...scene, userAudio: [{ id: 'u1', mediaId: 7, offset: 1500, trim: 200, volume: 0.5 }, { id: 'u2', mediaId: 99, offset: 0, trim: 0, volume: 1 }] };
  const media = [{ id: 7, name: 'lagu.mp3', mime: 'audio/mpeg', kind: 'audio', size: 1, url: 'blob:x', projectId: null }];
  const src = collectAudioSources(sc, media);
  assert.equal(src.length, 1);
  assert.deepEqual([src[0].startMs, src[0].trimMs, src[0].volume], [1500, 200, 0.5]);
});

test('semua efek yang diminta punya implementasi', () => {
  for (const fx of ['tile', 'oscillate', 'motionblur', 'lift', 'wipe', 'wavewarp', 'randomdisplace', 'fade', 'zoomblur', 'circularripple', 'displacemap', 'stretchsegment', 'lumakey', 'swing', 'fourcolorgradient', 'brightcont', 'gradientoverlay', 'mirror']) {
    assert.ok(SUPPORTED_EFFECTS.includes(fx), fx);
  }
});
