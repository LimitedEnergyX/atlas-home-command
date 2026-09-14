-- v1: IDs preserved; all relationships include tenant ownership.
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE tenants(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE locations(tenant_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id) REFERENCES tenants(id));
CREATE TABLE recipes(tenant_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,theme TEXT,
 instructions TEXT,notes TEXT,created_at TEXT,updated_at TEXT,revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id));
CREATE TABLE stock_items(tenant_id TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,category TEXT,
 status TEXT,expiration_date TEXT,refresh_watch INTEGER,notes TEXT,created_at TEXT,updated_at TEXT,
 quantity_amount TEXT,quantity_unit TEXT,
 revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id));
CREATE TABLE recipe_ingredients(tenant_id TEXT NOT NULL,id TEXT NOT NULL,recipe_id TEXT NOT NULL,
 stock_item_id TEXT,ingredient_name TEXT NOT NULL,quantity TEXT,created_at TEXT,revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id),
 FOREIGN KEY(tenant_id,recipe_id) REFERENCES recipes(tenant_id,id),
 FOREIGN KEY(tenant_id,stock_item_id) REFERENCES stock_items(tenant_id,id));
CREATE TABLE meal_plan(tenant_id TEXT NOT NULL,id TEXT NOT NULL,week_start_date TEXT NOT NULL,
 day_of_week TEXT NOT NULL CHECK(day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
 slot TEXT,theme TEXT,recipe_id TEXT,meal_name TEXT,notes TEXT,created_at TEXT,updated_at TEXT,
 revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id),
 FOREIGN KEY(tenant_id,recipe_id) REFERENCES recipes(tenant_id,id));
CREATE TABLE grocery_extra_items(tenant_id TEXT NOT NULL,id TEXT NOT NULL,week_start_date TEXT NOT NULL,
 item_name TEXT NOT NULL,notes TEXT,created_at TEXT,revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id) REFERENCES tenants(id));
CREATE TABLE grocery_dismissed_items(tenant_id TEXT NOT NULL,id TEXT NOT NULL,week_start_date TEXT NOT NULL,
 item_key TEXT NOT NULL,created_at TEXT,revision INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,week_start_date,item_key),FOREIGN KEY(tenant_id) REFERENCES tenants(id));
CREATE INDEX meal_week ON meal_plan(tenant_id,week_start_date,day_of_week,slot);
CREATE INDEX ingredient_recipe ON recipe_ingredients(tenant_id,recipe_id);
CREATE INDEX ingredient_stock ON recipe_ingredients(tenant_id,stock_item_id);
CREATE INDEX stock_name ON stock_items(tenant_id,name);
CREATE INDEX recipe_name ON recipes(tenant_id,name);
CREATE INDEX grocery_week ON grocery_extra_items(tenant_id,week_start_date);
CREATE TABLE audit_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,operation TEXT NOT NULL,table_name TEXT NOT NULL,row_id TEXT NOT NULL,
 before_json TEXT,after_json TEXT,occurred_at TEXT NOT NULL,FOREIGN KEY(tenant_id) REFERENCES tenants(id));
CREATE INDEX audit_tenant ON audit_events(tenant_id,sequence);
