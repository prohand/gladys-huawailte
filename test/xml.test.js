import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asArray, buildRequest, decodeEntities, parseXml } from '../src/huawei/xml.js';

test('parses a flat router answer', () => {
  const doc = parseXml(
    '<?xml version="1.0" encoding="UTF-8"?>\n<response>\n<rsrp>-95dBm</rsrp>\n<sinr>12dB</sinr>\n<cell_id></cell_id>\n<band/>\n</response>',
  );
  assert.deepEqual(doc, { response: { rsrp: '-95dBm', sinr: '12dB', cell_id: '', band: '' } });
});

test('parses a text-only answer and an error', () => {
  assert.deepEqual(parseXml('<response>OK</response>'), { response: 'OK' });
  assert.deepEqual(parseXml('<error><code>125002</code><message></message></error>'), {
    error: { code: '125002', message: '' },
  });
});

test('repeated elements become an array, a single one stays an object', () => {
  const two = parseXml(
    '<response><Messages><Message><Index>1</Index></Message><Message><Index>2</Index></Message></Messages></response>',
  );
  assert.deepEqual(two.response.Messages.Message, [{ Index: '1' }, { Index: '2' }]);
  const one = parseXml(
    '<response><Messages><Message><Index>1</Index></Message></Messages></response>',
  );
  assert.deepEqual(asArray(one.response.Messages.Message), [{ Index: '1' }]);
  assert.deepEqual(asArray(undefined), []);
});

test('decodes entities and keeps CDATA as is', () => {
  assert.equal(decodeEntities('a &amp; b &lt;3 &#233;&#x1F600;'), 'a & b <3 é😀');
  const doc = parseXml('<response><Content><![CDATA[<b>&amp;</b>]]></Content></response>');
  assert.equal(doc.response.Content, '<b>&amp;</b>');
});

test('refuses malformed XML', () => {
  assert.throws(() => parseXml('<response><a></b></response>'), /Malformed/);
  assert.throws(() => parseXml('<response><a>'), /never closed/);
});

test('builds a request in key order, escaping text and repeating arrays', () => {
  const xml = buildRequest({
    Index: -1,
    Phones: { Phone: ['+331', '+332'] },
    Sca: '',
    Content: 'Tom & Jerry <3',
    Empty: null,
  });
  assert.equal(
    xml,
    '<?xml version="1.0" encoding="UTF-8"?><request><Index>-1</Index><Phones><Phone>+331</Phone><Phone>+332</Phone></Phones><Sca></Sca><Content>Tom &amp; Jerry &lt;3</Content><Empty></Empty></request>',
  );
  // And it reads back.
  assert.equal(parseXml(xml).request.Content, 'Tom & Jerry <3');
});
