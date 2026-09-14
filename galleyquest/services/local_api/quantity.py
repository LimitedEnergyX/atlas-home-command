"""Strict household quantity parsing, without inventory or unit inference.

Amounts are decimal strings rounded half up to at most 12 fractional digits.
This matches quantity.js, including repeating fractions such as 1/3. Unit
aliases are normalized, but units are never converted or inferred. Blank
input means unknown (None); malformed or unsupported input raises ValueError.
"""

import re
from decimal import Decimal, ROUND_HALF_UP, localcontext


_UNICODE_FRACTIONS = {
    "¼": "1/4", "½": "1/2", "¾": "3/4", "⅐": "1/7", "⅑": "1/9",
    "⅒": "1/10", "⅓": "1/3", "⅔": "2/3", "⅕": "1/5", "⅖": "2/5",
    "⅗": "3/5", "⅘": "4/5", "⅙": "1/6", "⅚": "5/6", "⅛": "1/8",
    "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
}
_UNIT_GROUPS = {
    "gallon": "gallon gallons gal gals",
    "quart": "quart quarts qt qts",
    "pint": "pint pints pt pts",
    "cup": "cup cups",
    "tablespoon": "tablespoon tablespoons tbsp tbsps tbs",
    "teaspoon": "teaspoon teaspoons tsp tsps",
    "liter": "liter liters litre litres l",
    "milliliter": "milliliter milliliters millilitre millilitres ml",
    "pound": "pound pounds lb lbs",
    "ounce": "ounce ounces oz",
    "gram": "gram grams g",
    "kilogram": "kilogram kilograms kg",
    "milligram": "milligram milligrams mg",
    "each": "each ea item items piece pieces unit units",
    "egg": "egg eggs",
    "bottle": "bottle bottles",
    "can": "can cans",
    "jar": "jar jars",
    "bag": "bag bags",
    "box": "box boxes",
    "carton": "carton cartons",
    "package": "package packages pack packs pkg pkgs",
    "container": "container containers",
    "dozen": "dozen dozens",
    "serving": "serving servings",
    "slice": "slice slices",
    "clove": "clove cloves",
    "bunch": "bunch bunches",
    "head": "head heads",
    "stick": "stick sticks",
    "roll": "roll rolls",
    "loaf": "loaf loaves",
}
_UNITS = {alias: unit for unit, aliases in _UNIT_GROUPS.items() for alias in aliases.split()}
_UNITS.update({alias: "fluid ounce" for alias in ("fluid ounce", "fluid ounces", "fl oz", "fl. oz.")})
_NUMBER = re.compile(r"^(?:(\d+)\s+(\d+)\s*/\s*(\d+)|(\d+)\s*/\s*(\d+)|(\d+(?:\.\d*)?|\.\d+))(?:\s*([A-Za-z][A-Za-z. ]*))?$")


def parse_quantity(value):
    """Return {'amount': decimal_string, 'unit': canonical_unit}, or None.

    Missing units remain an empty string. No unit, package size, density,
    receipt status, or stock operation is inferred from an amount.
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ValueError("Quantity must be text or a finite nonnegative number.")
    text = str(value).strip()
    if not text:
        return None
    if len(text) > 128:
        raise ValueError("Quantity is too long.")
    for character, fraction in _UNICODE_FRACTIONS.items():
        text = text.replace(character, " " + fraction)
    text = text.strip()
    match = _NUMBER.fullmatch(text)
    if not match:
        raise ValueError("Use a nonnegative number or fraction followed by a supported unit.")
    whole, numerator, denominator, simple_num, simple_den, decimal, raw_unit = match.groups()
    unit_key = " ".join((raw_unit or "").lower().split())
    if unit_key and unit_key not in _UNITS:
        raise ValueError("Unsupported or ambiguous quantity unit.")
    with localcontext() as context:
        context.prec = 160
        if denominator or simple_den:
            den = Decimal(denominator or simple_den)
            num = Decimal(numerator or simple_num)
            if not den:
                raise ValueError("Fraction denominator must be greater than zero.")
            if whole is not None and num >= den:
                raise ValueError("The fractional part of a mixed number must be less than one.")
            amount = Decimal(whole or 0) + num / den
        else:
            amount = Decimal(decimal)
        amount = amount.quantize(Decimal("0.000000000001"), rounding=ROUND_HALF_UP)
    canonical = format(amount, "f").rstrip("0").rstrip(".")
    return {"amount": canonical or "0", "unit": _UNITS.get(unit_key, "")}
