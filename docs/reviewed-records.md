# Reviewed local records

These records belong in the operator's private data directory, not in the repository or static demo. Protect that directory with host access controls. The application is not intended to expose personal records to the public Internet.

## Calendar

Place a reviewed `calendar.json` in `ATLAS_DATA_DIR`. Refresh reads this local copy, not Google Calendar. Missing or invalid files produce an unavailable state; a review older than 24 hours is marked stale.

```json
{
  "schema_version": 1,
  "reviewed_at": "2030-06-01T12:00:00-05:00",
  "coverage_start": "2030-06-01",
  "coverage_end": "2030-06-08",
  "events": [{
    "id": "example-service",
    "calendar_id": "example",
    "title": "Vehicle service",
    "start": "2030-06-03T10:00:00-05:00",
    "end": "2030-06-03T10:30:00-05:00",
    "location": "Example service center",
    "note": "Illustrative appointment",
    "category": "vehicle",
    "status": "confirmed"
  }]
}
```

Use stable source IDs and timezone-bearing start/end times. Supply a single reviewed version of each event, including cancellations. Display uses America/Chicago. Do not put diagnoses, medications, clinical instructions, or medical attachments into the file. A `medical` category is reduced in the API response to a neutral title and a direction to use the official appointment app. That response filter does not erase sensitive content from the source file.

## Charging references

Place `charging-records.json` in `ATLAS_DATA_DIR`:

```json
{
  "schema_version": 1,
  "records": [{
    "id": "example-session",
    "date": "2030-06-01",
    "source": "Home",
    "kwh": 8,
    "solar": 6,
    "battery": 1,
    "grid": 1,
    "rated_miles": 20,
    "detail": "Fictional example. Replace with a reviewed source."
  }]
}
```

Allowed sources are Home, Supercharger, and Other. `kwh` is energy, not instantaneous kW. Omit an unknown split or mileage field; do not fill it with zero. Rated miles are a supplied range estimate, not distance actually driven. Duplicate IDs and invalid quantities reject the file. Totals are reference totals only, not complete charging history. Do not enter overlapping references as distinct sessions.

The built-in static demo uses fictional references independently of this local file.

## Vehicle profiles

The Argo database starts empty. Prepare a JSON file with `schema_version: 1` and an `assets` array. Each asset requires `id`, `name`, and `source`. Supported internal slots are `vehicle-athena`, `vehicle-big-red`, and `vehicle-harley`, displayed by the navigation as Electric Car, Truck, and Motorcycle.

Optional fields: `manufacturer`, `model`, `model_year`, `summary`, `color`, `odometer_miles`, and `events`. Event fields are `event_date` (YYYY-MM-DD), `title`, `detail`, and `state` (complete, planned, or canceled). Imported mileage is approximate, not telemetry. Separate service items with semicolons for bullet display.

```sh
python -m atlas_orchestrator.vehicle_import ./reviewed-vehicles.json --data-dir ./data
# Only after checking the validation and target directory:
python -m atlas_orchestrator.vehicle_import ./reviewed-vehicles.json --data-dir ./data --apply
```

The default validates without touching the database. Apply is transactional and refuses to overwrite any existing vehicle slot. Back up existing data before deliberate migrations. There is no vehicle edit UI, automatic CARFAX import, document-serving route, or cloud write in this release.
