ALTER TABLE recipes ADD COLUMN s_firma INTEGER NOT NULL DEFAULT 0;

UPDATE recipes
   SET s_firma = 1
 WHERE (s_lunch = 1 OR s_dinner = 1)
   AND micro_ok = 1
   AND shelf_days >= 3
   AND dtype IN ('suppe', 'reis', 'auflauf', 'pasta', 'pfanne', 'kartoffel');
