import assert from 'node:assert/strict';
import { prepareImageForWechat } from '../src/adapters/image-encode';

const small =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=';
const prepared = await prepareImageForWechat(small);
assert.equal(prepared.dataUrl, small);
assert.match(prepared.filename, /\.png$/);

const large = 'data:image/png;base64,' + 'A'.repeat(2_000_000);
const fallback = await prepareImageForWechat(large);
assert.equal(fallback.dataUrl, large);
assert.match(fallback.filename, /\.png$/);

import { encodeImageForWechat } from '../src/adapters/image-encode';

function fakeCanvas(data: string, context = true) {
  return {
    width: 0,
    height: 0,
    getContext: () => (context ? { fillStyle: '', fillRect: () => {}, drawImage: () => {} } : null),
    toDataURL: () => data,
  };
}

const smallCanvas = fakeCanvas('data:image/jpeg;base64,AAAA');
const encoded = encodeImageForWechat({ naturalWidth: 100, naturalHeight: 100 }, { createElement: () => smallCanvas });
assert.equal(encoded, 'data:image/jpeg;base64,AAAA');
assert.equal(
  encodeImageForWechat({ naturalWidth: 10, naturalHeight: 10 }, { createElement: () => fakeCanvas('', false) }),
  null,
);

let calls = 0;
const shrinking = {
  width: 0,
  height: 0,
  getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
  toDataURL: () => {
    calls++;
    return 'data:image/jpeg;base64,' + (calls === 1 ? 'A'.repeat(1_500_000) : 'B'.repeat(100));
  },
};
assert.equal(
  encodeImageForWechat({ naturalWidth: 800, naturalHeight: 600 }, { createElement: () => shrinking }),
  'data:image/jpeg;base64,' + 'B'.repeat(100),
);

let canvases = 0;
const tooLarge = {
  width: 0,
  height: 0,
  getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
  toDataURL: () => 'data:image/jpeg;base64,' + 'C'.repeat(1_500_000),
};
assert.equal(
  encodeImageForWechat(
    { naturalWidth: 800, naturalHeight: 600 },
    {
      createElement: () => {
        canvases++;
        return tooLarge;
      },
    },
  ),
  null,
);
assert.equal(canvases, 2, 'a smaller canvas is attempted when needed');

console.log('6 image-encode checks passed.');
