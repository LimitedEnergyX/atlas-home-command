import unittest
from decimal import Decimal

from quantity import parse_quantity


class QuantityTests(unittest.TestCase):
    def test_valid_quantities(self):
        cases = [
            ("1/2 gallon", "0.5", "gallon"), (".5 gallons", "0.5", "gallon"),
            ("1 1/2 gallons", "1.5", "gallon"), ("½ gallon", "0.5", "gallon"),
            ("1½ gal", "1.5", "gallon"), ("¾ CUP", "0.75", "cup"),
            ("0", "0", ""), (0, "0", ""), (0.5, "0.5", ""),
            (Decimal("0.50"), "0.5", ""), ("1/2", "0.5", ""),
            ("2 lbs", "2", "pound"), ("8 fl oz", "8", "fluid ounce"),
            ("8 oz", "8", "ounce"), ("2 cartons", "2", "carton"),
            ("12 eggs", "12", "egg"), ("2 dozen", "2", "dozen"),
            ("  0.5000   Gallons  ", "0.5", "gallon"),
            ("1 / 2 liter", "0.5", "liter"), ("1000 ml", "1000", "milliliter"),
            ("1/3 cup", "0.333333333333", "cup"), ("2/3 cup", "0.666666666667", "cup"),
            ("0.0000000000005 g", "0.000000000001", "gram"),
            ("⅝ gallon", "0.625", "gallon"), ("5/2 gallons", "2.5", "gallon"),
            ("10", "10", ""), ("100.000", "100", ""),
        ]
        for value, amount, unit in cases:
            with self.subTest(value=value):
                self.assertEqual(parse_quantity(value), {"amount": amount, "unit": unit})

    def test_empty_is_unknown(self):
        for value in [None, "", "   "]:
            self.assertIsNone(parse_quantity(value))

    def test_invalid_quantities(self):
        for value in ["-1", "-0.5 gal", "-0", "1/0", "1 1/0 cup", "NaN", "Infinity",
                      float("nan"), float("inf"), True, [], {}, "half a gallon", "about 2 cups",
                      "2 cups left", "1 gallon or 2", "1-2", "1e3", "1,000", "2 widgets",
                      "1 3/2", "½½", "2 + 3", "1/2/3", "1" * 129]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    parse_quantity(value)


if __name__ == "__main__":
    unittest.main()
