# Essensplan

Vollautomatischer Wochen-Essensplan für Frühstück, Mittag, Snack und Abendessen.
Jeden Freitag entsteht der Plan für die nächste Woche. Danach lässt er sich in einer Web-App bearbeiten (PWA, Handy-tauglich) und liefert eine Einkaufsliste.

- **Kein KI-Einsatz**: Rezepte werden nur gesucht und eingeordnet, nie erfunden.
- **Kostenlos**: Cloudflare Workers + D1 (Free) und GitHub Actions (Free).
- **Kein Rezepttext wird gespeichert**: nur Titel, Zutaten, Bild-Link und der Link zum Original.

## Wie es funktioniert

```
GitHub Actions (Freitag)                       Cloudflare
  1. Rezepte aus Sitemaps der Seiten importieren  ──►  D1-Datenbank  ◄──  Worker (API + Web-App)
  2. Plan erzeugen (Regeln, Zufall mit Seed)      ──►                       ▲
                                                                          └── du (Handy/PC)
```

Der Import und die Planung laufen in GitHub Actions, weil der kostenlose Worker nur ca. 10 ms Rechenzeit pro Anfrage hat. Der Worker liefert nur die Oberfläche und die Bearbeitung einzelner Einträge.

## Einrichtung (ca. 30 Minuten, einmalig)

### 1. GitHub: Repository anlegen

1. Auf github.com oben rechts **+ → New repository**. Name `essensplan`, **Private**, ohne README. **Create repository**.
2. ZIP entpacken. Im neuen Repo **uploading an existing file** klicken und den **gesamten Inhalt** des entpackten Ordners hineinziehen (auch den versteckten Ordner `.github`). **Commit changes**.
3. Prüfen: Im Repo muss die Datei `.github/workflows/weekly.yml` sichtbar sein. Falls nicht: **Add file → Create new file**, als Namen `.github/workflows/weekly.yml` eingeben und den Inhalt aus der ZIP einfügen.

### 2. Cloudflare: Datenbank anlegen

1. dash.cloudflare.com → links **Storage & databases → D1 SQL database → Create database**. Name `essensplan`. **Create**.
2. In der Datenbank den Tab **Console** öffnen, den kompletten Inhalt von `migrations/0001_init.sql` einfügen und ausführen. Falls die Konsole meckert, die Anweisungen einzeln (je bis zum Semikolon) ausführen.
3. Auf der Seite der Datenbank die **Database ID** kopieren.
4. In GitHub die Datei `wrangler.jsonc` öffnen (Stift-Symbol), `HIER-DIE-DATABASE-ID-EINTRAGEN` durch die ID ersetzen und committen.

### 3. Cloudflare: Web-App veröffentlichen

1. **Workers & Pages → Create → Import a repository** (bei Cloudflare ggf. „Connect to Git“). GitHub verbinden und nur das Repo `essensplan` freigeben.
2. Projektname `essensplan` (muss zum Namen in `wrangler.jsonc` passen). Build- und Deploy-Befehle so lassen, wie vorgeschlagen (`npx wrangler deploy`). **Save and Deploy**.
3. Nach dem Deploy: **Settings → Variables and Secrets → Add**. Typ **Secret**:
   - `APP_PASSWORD` = dein Login-Passwort für die App
   - `SESSION_SECRET` = lange Zufallszeichenfolge (z. B. 40+ Zeichen aus einem Passwortgenerator)
4. Die Adresse der App steht oben (`https://essensplan.<dein-name>.workers.dev`).

### 4. Zugangsdaten für GitHub Actions

1. Cloudflare: oben rechts Profil → **My Profile → API Tokens → Create Token → Create Custom Token**.
   Berechtigung: **Account → D1 → Edit**, Account Resources: dein Account. Token kopieren (wird nur einmal angezeigt).
2. Deine **Account ID**: Cloudflare-Startseite, rechts neben dem Account-Namen **⋮ → Copy account ID**.
3. GitHub-Repo: **Settings → Secrets and variables → Actions → New repository secret**, drei Stück:
   - `CF_ACCOUNT_ID`
   - `CF_API_TOKEN`
   - `D1_DATABASE_ID`
   - optional `NTFY_TOPIC`: ein frei gewählter, schwer zu erratender Name; dann kommt freitags eine Push-Nachricht über die App **ntfy**.

### 5. Erster Lauf

1. GitHub → **Actions → Wochenplan → Run workflow**. `step = import`, `import_limit = 100`. Dauert je nach Seitenzahl 20–40 Minuten (1 Anfrage alle 3 Sekunden pro Seite).
2. Im Lauf unten die **Zusammenfassung** ansehen: pro Quelle URLs, passende URLs, Rezepte, gesperrte, „ohne JSON-LD“. Quellen mit 0 Rezepten: `urlPattern` in `config/sources.json` anpassen.
3. Den Import 2–3× wiederholen, bis ca. **300+ nutzbare Rezepte** da sind (steht im Log: „Datenbank: … nutzbar“).
4. Dann `step = plan`. Danach in der App einloggen.

Ab jetzt läuft jeden Freitag (ca. 17/18 Uhr) automatisch: etwas Import (60 neue Seiten je Quelle), dann der Plan für die kommende Woche.

### 6. Optional: „Woche neu erzeugen“ per Knopf in der App

GitHub → Profil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Nur Repo `essensplan`, Berechtigung **Actions: Read and write**. Im Cloudflare-Worker unter **Variables and Secrets** anlegen: `GH_TOKEN` (Secret) und `GH_REPO` = `deinname/essensplan`. Ohne das: im GitHub-Tab Actions den Lauf mit `step = plan`, `force = true` und der Woche starten.

## Bedienung

- **Plan**: Tage mit Mahlzeiten. 🔄 tauscht zufällig, ✏️ öffnet Vorschläge, Suche, eigenen Text, Portionen, Notiz, „Mag ich“, „Nie wieder“.
- **Einkauf**: gruppiert, abhakbar, kopierbar. Salz/Öl/Wasser stehen unter „Vorrat“.
- **Woche**: Extra-Personen in der Firma (0–4), Tage, an denen Papa selbst kocht, Bruder-Tage (alles kalt essbar), Personen am Abend, HelloFresh-Tage. Gilt für neu erzeugte Pläne; Standardwerte für alle Wochen speicherbar.
- Als App installieren: im Browser **Zum Startbildschirm hinzufügen**.

## Regeln anpassen

Alles Wichtige steht in `config/` (Datei in GitHub bearbeiten und committen):

| Datei | Inhalt |
|---|---|
| `blocklist.json` | Dinge, die du nicht magst, mit Modus `always` / `raw` (nur roh) / `large` (nur große Stücke) |
| `rules.json` | Hafer-Limit, Vorbereitungszeit (120 min), Abend-Höchstdauer, Wiederholungspause (6 Wochen), Gewichte, Standardwerte der Woche |
| `sources.json` | Rezeptseiten, Sitemaps, URL-Muster |

Nach Änderung an `blocklist.json` im Actions-Tab `step = reblock` starten, damit schon gespeicherte Rezepte neu bewertet werden.

## Grenzen und Hinweise

- **Einordnung ist heuristisch** (Frühstück/Mittag/Abend, kalt essbar, Haltbarkeit, „roh“, „große Stücke“). Fehlgriffe kommen vor. „Nie wieder“ und „Mag ich“ lernen mit.
- **Rohe Tomaten/Zwiebeln**: gesperrt in Salat, Sandwich, Wrap, Burger, Bowl usw. oder bei Hinweisen wie „zum Garnieren“. In Soßen und Pfannen bleiben sie erlaubt.
- **Fruktose** ist nur eine weiche Regel (Abzug im Score), keine Sperre.
- **Nutzungsbedingungen** der Rezeptseiten prüfst du selbst. Der Import hält robots.txt ein, nutzt eine Pause von 3 s und speichert keine Rezepttexte. Nur für den privaten Gebrauch gedacht.
- **Cloudflare Free**: 10 ms CPU pro Anfrage. Deshalb tauscht die App einzelne Einträge selbst, die ganze Woche wird in GitHub Actions neu erzeugt.
- Meal-Prep-Blöcke: Mittag/Frühstück werden in 2er/3er-Blöcken geplant (ein Rezept für mehrere Tage, nur wenn haltbar genug). Reste vom Vortag werden bevorzugt, wenn das Abendessen als Mittag taugt.

## Entwicklung

```
npm install
npm test            # 24 Tests (Sperrliste, Parser, Generator, Einkauf, Datum)
npx wrangler dev    # lokal; .dev.vars mit APP_PASSWORD und SESSION_SECRET anlegen
```

## Neu in Version 2

- **Firma-Gerichte**: An Tagen mit „Papa kocht“ (Standard: Di und Do) bekommt die Firma ein eigenes vorkochbares Gericht (Suppe, Reis, Auflauf, Pasta, Pfanne, Kartoffel), das dort nur noch aufgewärmt wird. Die Portionen entsprechen den Extra-Personen.
- **Vorbereitung**: Tab „Vorbereitung“ mit zwei Sessions – Sonntag (Ziel höchstens 2 h) und Mittwochabend (Ziel höchstens 1 h). Gerichte, die bis Freitag nicht haltbar wären, kommen in die Mittwochs-Session; schnell verderbliche werden frisch zubereitet. Überschreitungen erscheinen als Warnung.
- **Einkaufsliste mit Zeitpunkt**: Jede Zutat zeigt, wann sie gebraucht wird (z. B. „So Vorbereitung“, „Do Abend kochen“).
- **PDF**: Button „PDF / Drucken“ in der App (Druckdialog → „Als PDF speichern“). Jeden Freitag erzeugt GitHub Actions zusätzlich ein PDF (Plan, Vorbereitung, Einkaufsliste), hängt es als Artefakt an den Lauf und schickt es per Mail, wenn die Secrets `RESEND_API_KEY` und `MAIL_TO` (optional `MAIL_FROM`) gesetzt sind. Ohne Domain kann der Resend-Testabsender nur an die eigene Konto-Adresse senden.
- **Datenbank-Migration**: Einmalig `migrations/0002_firma.sql` in der D1-Konsole ausführen.
- Manuell auslösen: Actions → Wochenplan → Run workflow → `step = pdf`.
