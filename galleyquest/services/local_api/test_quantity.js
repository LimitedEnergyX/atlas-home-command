'use strict';
const assert = require('node:assert/strict');
const {parse} = require('./quantity.js');
const valid = [
  ['1/2 gallon','0.5','gallon'], ['.5 gallons','0.5','gallon'], ['1 1/2 gallons','1.5','gallon'],
  ['½ gallon','0.5','gallon'], ['1½ gal','1.5','gallon'], ['¾ CUP','0.75','cup'],
  ['0','0',''], [0,'0',''], [0.5,'0.5',''], ['1/2','0.5',''], ['2 lbs','2','pound'],
  ['8 fl oz','8','fluid ounce'], ['8 oz','8','ounce'], ['2 cartons','2','carton'],
  ['12 eggs','12','egg'], ['2 dozen','2','dozen'], ['  0.5000   Gallons  ','0.5','gallon'],
  ['1 / 2 liter','0.5','liter'], ['1000 ml','1000','milliliter'],
  ['1/3 cup','0.333333333333','cup'], ['2/3 cup','0.666666666667','cup'],
  ['0.0000000000005 g','0.000000000001','gram'], ['⅝ gallon','0.625','gallon'],
  ['5/2 gallons','2.5','gallon'], ['10','10',''], ['100.000','100','']
];
for (const [value, amount, unit] of valid) assert.deepEqual(parse(value), {amount, unit}, String(value));
for (const value of [null, undefined, '', '   ']) assert.equal(parse(value), null);
const invalid = ['-1','-0.5 gal','-0','1/0','1 1/0 cup','NaN','Infinity',NaN,Infinity,true,[],{},
  'half a gallon','about 2 cups','2 cups left','1 gallon or 2','1-2','1e3','1,000','2 widgets',
  '1 3/2','½½','2 + 3','1/2/3','1'.repeat(129)];
for (const value of invalid) assert.throws(() => parse(value), Error, String(value));
console.log(`Quantity normalization passed: ${valid.length} valid, 4 unknown, ${invalid.length} invalid cases.`);
