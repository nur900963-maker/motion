import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAmXml, XmlError, cubicBezier, sampleKeyframes, blendToComposite, argbToCss } from '../lib/am-xml.ts';

const sample = readFileSync(new URL('../public/sample-preset.xml', import.meta.url), 'utf8');

test('preset contoh (format Alight Motion) terbaca lengkap', () => {
  const s = parseAmXml(sample, 'sample');
  assert.equal(s.name, 'Contoh Xmotion');
  assert.equal(s.width, 1080);
  assert.equal(s.height, 1920);
  assert.equal(s.fps, 30);
  assert.equal(s.duration, 4000);
  assert.deepEqual(s.bookmarks, [2000]);
  assert.equal(s.layers.length, 4);
  assert.equal(s.bgColor, 'rgba(11,16,32,1.000)');
});

test('urutan layer mengikuti urutan dokumen (z-order)', () => {
  const s = parseAmXml(sample);
  assert.deepEqual(s.layers.map((l) => l.id), ['1', '2', '3', '4']);
});

test('tipe layer: shape+media = image, geometri & ukuran dibaca', () => {
  const s = parseAmXml(sample);
  const [bg, box, circle, slot] = s.layers;
  assert.equal(bg.fillType, 'gradient');
  assert.equal(bg.gradient.type, 'linear');
  assert.equal(box.shape, 'roundrect');
  assert.equal(box.cornerRadius, 60);
  assert.equal(box.width, 420);
  assert.equal(circle.shape, 'circle');
  assert.equal(circle.blending, 'linear-dodge');
  assert.equal(slot.type, 'image');
  assert.equal(slot.mediaRef, 'content://media/external/images/media/1');
  assert.deepEqual(s.mediaRefs, ['content://media/external/images/media/1']);
});

test('keyframe: t fraksi durasi layer dikonversi ke ms, easing masuk dibaca', () => {
  const box = parseAmXml(sample).layers[1]; // start 300, end 3700 → span 3400
  const loc = box.keyframes.location;
  assert.equal(loc.length, 3);
  assert.equal(loc[0].t, 300);
  assert.equal(loc[1].t, 300 + 0.5 * 3400);
  assert.equal(loc[2].t, 3700);
  assert.equal(loc[0].e, undefined);
  assert.deepEqual(loc[1].e, [0, 0, 0.2, 1]);
});

test('keyframe yang tidak berurutan di file diurutkan menurut waktu', () => {
  const xml = `<scene width="100" height="100" fps="30" totalTime="1000">
    <shape id="1" startTime="0" endTime="1000" fillType="color" s=".rect">
      <transform><opacity><kf t="1.0" v="0" /><kf t="0.0" v="1" /><kf t="0.5" v="0.5" /></opacity></transform>
      <property name="size" type="vec2" value="10,10" /></shape></scene>`;
  const l = parseAmXml(xml).layers[0];
  assert.deepEqual(l.keyframes.opacity.map((k) => k.t), [0, 500, 1000]);
  assert.equal(l.opacity, 1);
});

test('nilai statis (value="...") dan efek + parameternya terbaca', () => {
  const s = parseAmXml(sample);
  assert.deepEqual([s.layers[2].x, s.layers[2].y], [540, 1500]);
  const fx = s.layers[3].effects[0];
  assert.equal(fx.name, 'satvib');
  assert.equal(fx.params.saturation.value[0], 1.25);
});

test('efek yang belum didukung renderer dilaporkan di warnings; wavewarp kini didukung', () => {
  const xml = `<scene width="10" height="10" fps="30" totalTime="1000"><shape id="1" startTime="0" endTime="1000" fillType="color" s=".rect">
    <effect id="com.alightcreative.effects.wavewarp2"><property name="phase" type="float" value="1" /></effect>
    <effect id="com.alightcreative.effects.holograph"><property name="strength" type="float" value="1" /></effect></shape></scene>`;
  const s = parseAmXml(xml);
  assert.ok(!s.warnings.some((w) => w.includes('wavewarp')));
  assert.ok(s.warnings.some((w) => w.includes('holograph')));
});

test('fillVideo dibaca sebagai slot video (mediaRef bukan null)', () => {
  const xml = `<scene width="10" height="10" fps="30" totalTime="1000">
    <media uri="am:abc123.mp4" filename="abc123.mp4" title="Glicht" type="video/mp4" width="1280" height="720" duration="4000000" />
    <shape id="1" label="CC" startTime="0" endTime="1000" fillType="media" fillVideo="am:abc123.mp4" mediaFillMode="fill" s=".rect">
      <property name="size" type="vec2" value="10,10" /></shape></scene>`;
  const s = parseAmXml(xml);
  const l = s.layers[0];
  assert.equal(l.type, 'video');
  assert.equal(l.mediaRef, 'am:abc123.mp4');
  assert.equal(s.mediaDecls.length, 1);
  assert.equal(s.mediaDecls[0].title, 'Glicht');
  assert.ok(!s.warnings.some((w) => w.includes('Elemen belum dikenali')));
});

test('<nullobj> dan <embedScene> dikenali (tidak jadi warning)', () => {
  const xml = `<scene width="10" height="10" fps="30" totalTime="4000">
    <nullobj id="9" label="Nol 1" startTime="0" endTime="1000" type="perspective"><transform><location value="5,5,0" /></transform></nullobj>
    <embedScene id="8" startTime="1000" endTime="2000" fillType="intrinsic" mediaFillMode="fill">
      <scene title="Group" width="10" height="10" totalTime="1000" fps="30">
        <shape id="7" label="Bar" startTime="0" endTime="1000" fillType="color" s=".rect">
          <transform><location value="5,5,0" /></transform>
          <property name="size" type="vec2" value="10,10" /></shape>
      </scene>
    </embedScene>
  </scene>`;
  const s = parseAmXml(xml);
  assert.equal(s.layers.length, 2);
  assert.equal(s.layers[0].isNull, true);
  assert.equal(s.layers[0].visible, false);
  const embed = s.layers[1];
  assert.equal(embed.children.length, 1);
  const bar = embed.children[0];
  assert.equal(bar.start, 1000); // waktu anak digeser ke jendela embed
  assert.equal(bar.end, 2000);
  assert.ok(!s.warnings.some((w) => w.includes('Elemen belum dikenali')));
});

test('easing elastic & reverse elastic dievaluasi (bukan linear)', () => {
  const xml = `<scene width="10" height="10" fps="30" totalTime="1000"><shape id="1" startTime="0" endTime="1000" fillType="color" s=".rect">
    <transform><opacity>
      <kf t="0" v="0" /><kf t="1" v="1" e="reverse elastic 0.36939573 1.0 0.0 1.0" />
    </opacity></transform>
    <property name="size" type="vec2" value="10,10" /></shape></scene>`;
  const s = parseAmXml(xml);
  const kfs = s.layers[0].keyframes.opacity;
  assert.equal(kfs[1].easeName, 'reverse elastic');
  const mid = sampleKeyframes(kfs, 500, 0, 0);
  assert.ok(Math.abs(mid - 0.5) > 0.01); // kurva pegas, bukan garis lurus
  assert.ok(mid > 0.2 && mid < 1.4); // overshoot sehat
  assert.ok(!s.warnings.some((w) => w.includes('Kurva easing tak dikenal')));
});

test('shadow & path-stroke pada shape terbaca', () => {
  const xml = `<scene width="10" height="10" fps="30" totalTime="1000"><shape id="1" startTime="0" endTime="1000" fillType="color" s=".rect">
    <fillColor value="#ffffffff" />
    <path-stroke direction="centered" end-size="1.5"><color value="#ff000000" /><size value="12" /></path-stroke>
    <shadow direction="outside"><color value="#ffffffff" /><size value="30" /><hardness value="1" /><offset value="2,3" /></shadow>
    <property name="size" type="vec2" value="10,10" /></shape></scene>`;
  const l = parseAmXml(xml).layers[0];
  assert.equal(l.stroke.width, 12);
  assert.equal(l.stroke.color, 'rgba(0,0,0,1.000)');
  assert.equal(l.shadow.color, 'rgba(255,255,255,1.000)');
  assert.equal(l.shadow.blur, 30);
  assert.deepEqual([l.shadow.offsetX, l.shadow.offsetY], [2, 3]);
});

test('referensi karakter numerik di atribut didecode', () => {
  const xml = `<scene title="&#120293;&#120284;" width="10" height="10" fps="30" totalTime="1000"><shape id="1" startTime="0" endTime="10" fillType="color" s=".rect" /></scene>`;
  assert.equal(parseAmXml(xml).name, '\u{1D5E5}\u{1D5DC}');
});

test('input salah ditolak dengan pesan jelas', () => {
  assert.throws(() => parseAmXml(''), XmlError);
  assert.throws(() => parseAmXml('<!DOCTYPE html><html><body>x</body></html>'), /halaman web/);
  assert.throws(() => parseAmXml('<project><layer/></project>'), /<scene>/);
  assert.throws(() => parseAmXml('<scene width="10" height="10"></scene>'), /tidak berisi layer/);
});

test('cubicBezier: ujung 0/1, linear, dan ease-in monoton', () => {
  assert.equal(cubicBezier(0.4, 0, 0.6, 1, 0), 0);
  assert.equal(cubicBezier(0.4, 0, 0.6, 1, 1), 1);
  assert.ok(Math.abs(cubicBezier(0, 0, 1, 1, 0.3) - 0.3) < 1e-4);
  const ease = [0.1, 0.25, 0.5, 0.75, 0.9].map((x) => cubicBezier(0.42, 0, 1, 1, x));
  for (let i = 1; i < ease.length; i++) assert.ok(ease[i] > ease[i - 1]);
  assert.ok(cubicBezier(0.42, 0, 1, 1, 0.25) < 0.25); // ease-in: lebih lambat di awal
});

test('sampleKeyframes: tahan di ujung, linear tanpa easing, easing dari keyframe tujuan', () => {
  const lin = [{ t: 0, v: [0] }, { t: 1000, v: [100] }];
  assert.equal(sampleKeyframes(lin, -5, 0, 9), 0);
  assert.equal(sampleKeyframes(lin, 500, 0, 9), 50);
  assert.equal(sampleKeyframes(lin, 5000, 0, 9), 100);
  assert.equal(sampleKeyframes(undefined, 5, 0, 9), 9);
  const eased = [{ t: 0, v: [0] }, { t: 1000, v: [100], e: [0.42, 0, 1, 1] }];
  assert.ok(sampleKeyframes(eased, 250, 0, 0) < 25);
});

test('blend & warna', () => {
  assert.equal(blendToComposite('linear-dodge'), 'lighter');
  assert.equal(blendToComposite('multiply'), 'multiply');
  assert.equal(blendToComposite(undefined), 'source-over');
  assert.equal(argbToCss('#ff5fe663'), 'rgba(95,230,99,1.000)');
  assert.equal(argbToCss('#80000000'), 'rgba(0,0,0,0.502)');
});
