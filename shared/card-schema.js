// schema ของ cards/data.csv ตาม spec หัวข้อ 4.1 (ใช้ได้ทั้ง server และ browser)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CARD_SCHEMA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {
    templates: ['unit', 'ambush', 'showdown', 'gold'],
    columns: {
      id: { type: 'id', required: true, rule: true },
      template: { type: 'enum', values: ['unit', 'ambush', 'showdown', 'gold'], required: true, rule: true },
      name: { type: 'text', required: true, max: 18 },
      kind_label: { type: 'text', required: true, max: 16 },
      effect: { type: 'text', max: 300 },
      color: { type: 'color', requiredFor: 'unit', unique: true, rule: true },
      value: { type: 'int', values: [3, 4, 5], requiredFor: 'gold', rule: true },
      art: { type: 'id' },
    },
    runtime: ['player_name'], // ช่องที่ client เติมเอง ไม่อยู่ใน CSV
    secret: [],               // ไม่มีคอลัมน์ลับใน catalog
    required: ['ambush', 'share', 'steal', 'grab', 'gold-3', 'gold-4', 'gold-5'],
    idPattern: /^[a-z0-9][a-z0-9-]{0,39}$/,
    artExt: ['webp', 'png', 'jpg'],
  };
});
