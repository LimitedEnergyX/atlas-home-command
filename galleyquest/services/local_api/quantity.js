/* Strict quantity normalization. No stock writes or inferred unit conversions.
 * Decimal strings are rounded half up to 12 fractional digits, matching Python.
 * BigInt rational arithmetic avoids binary floating-point parsing surprises.
 * Empty input returns null; invalid input throws Error.
 */
(function (root) {
  'use strict';
  const fractions = {'¼':'1/4','½':'1/2','¾':'3/4','⅐':'1/7','⅑':'1/9','⅒':'1/10','⅓':'1/3','⅔':'2/3','⅕':'1/5','⅖':'2/5','⅗':'3/5','⅘':'4/5','⅙':'1/6','⅚':'5/6','⅛':'1/8','⅜':'3/8','⅝':'5/8','⅞':'7/8'};
  const groups = {
    gallon:'gallon gallons gal gals', quart:'quart quarts qt qts', pint:'pint pints pt pts', cup:'cup cups',
    tablespoon:'tablespoon tablespoons tbsp tbsps tbs', teaspoon:'teaspoon teaspoons tsp tsps',
    liter:'liter liters litre litres l', milliliter:'milliliter milliliters millilitre millilitres ml',
    pound:'pound pounds lb lbs', ounce:'ounce ounces oz', gram:'gram grams g', kilogram:'kilogram kilograms kg', milligram:'milligram milligrams mg',
    each:'each ea item items piece pieces unit units', egg:'egg eggs', bottle:'bottle bottles', can:'can cans', jar:'jar jars', bag:'bag bags', box:'box boxes',
    carton:'carton cartons', package:'package packages pack packs pkg pkgs', container:'container containers', dozen:'dozen dozens', serving:'serving servings',
    slice:'slice slices', clove:'clove cloves', bunch:'bunch bunches', head:'head heads', stick:'stick sticks', roll:'roll rolls', loaf:'loaf loaves'
  };
  const units = new Map();
  for (const [unit, aliases] of Object.entries(groups)) for (const alias of aliases.split(' ')) units.set(alias, unit);
  for (const alias of ['fluid ounce','fluid ounces','fl oz','fl. oz.']) units.set(alias, 'fluid ounce');
  const numberPattern = /^(?:(\d+)\s+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d+(?:\.\d*)?|\.\d+))(?:\s*([A-Za-z][A-Za-z. ]*))?$/;

  function parse(value) {
    if (value === null || value === undefined) return null;
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Quantity must be text or a finite nonnegative number.');
    let text = String(value).trim();
    if (!text) return null;
    if (text.length > 128) throw new Error('Quantity is too long.');
    for (const [character, fraction] of Object.entries(fractions)) text = text.split(character).join(' ' + fraction);
    const match = numberPattern.exec(text.trim());
    if (!match) throw new Error('Use a nonnegative number or fraction followed by a supported unit.');
    const [, whole, numerator, denominator, simpleNum, simpleDen, decimal, rawUnit] = match;
    const unitKey = (rawUnit || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (unitKey && !units.has(unitKey)) throw new Error('Unsupported or ambiguous quantity unit.');
    let num, den;
    if (denominator || simpleDen) {
      den = BigInt(denominator || simpleDen);
      num = BigInt(numerator || simpleNum);
      if (den === 0n) throw new Error('Fraction denominator must be greater than zero.');
      if (whole !== undefined && num >= den) throw new Error('The fractional part of a mixed number must be less than one.');
      num += BigInt(whole || '0') * den;
    } else {
      const [integer, fraction = ''] = decimal.split('.');
      num = BigInt((integer || '0') + fraction);
      den = 10n ** BigInt(fraction.length);
    }
    const scale = 1000000000000n;
    const scaledNumerator = num * scale;
    let scaled = scaledNumerator / den;
    if ((scaledNumerator % den) * 2n >= den) scaled += 1n;
    const digits = scaled.toString().padStart(13, '0');
    const fraction = digits.slice(-12).replace(/0+$/, '');
    const amount = digits.slice(0, -12) + (fraction ? '.' + fraction : '');
    return {amount, unit: units.get(unitKey) || ''};
  }
  const api = Object.freeze({parse});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.GalleyQuantity = api;
})(typeof window !== 'undefined' ? window : null);
