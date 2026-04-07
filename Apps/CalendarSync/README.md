# Crunchyroll Calendar Sync

## Datei

```text
Apps/CalendarSync/Crunchyroll-Calendar-Sync.gs
```

## Zweck

Dieses Skript synchronisiert Einträge aus dem Crunchyroll-Simulcast-Kalender in einen eigenen Google Kalender.

Dabei wird die Crunchyroll-Seite wochenweise geladen und ausgewertet. Das Skript kann:

- vergangene Wochen erneut einlesen,
- zukünftige Wochen prüfen,
- Einträge im Google Kalender anlegen,
- bestehende Einträge aktualisieren,
- Dubletten vermeiden,
- optional veraltete Einträge wieder entfernen,
- und zusätzlich einen ICS-Feed als Web-Endpunkt bereitstellen.

## Unterstützte Quelle

Das Skript ist für die Premium-Simulcast-Seite ausgelegt:

```text
https://www.crunchyroll.com/de/simulcastcalendar?filter=premium
```

Zusätzlich wird die Wochen-Navigation über einen Datumsparameter genutzt:

```text
&date=YYYY-MM-DD
```

Dabei muss `YYYY-MM-DD` dem Montag der jeweiligen Woche entsprechen.

## Funktionsweise im Überblick

Das Skript arbeitet in mehreren Schritten:

1. Ermittlung des aktuellen Wochen-Montags
2. Laden mehrerer Crunchyroll-Kalenderwochen
3. Rückblick über mehrere Wochen in die Vergangenheit
4. Zukunftsscan bis zur ersten Woche mit nur „Zeitplan kommt bald“
5. Parsen der sichtbaren Kalendereinträge
6. optionale Filterung nach Sprach-/Dub-Informationen
7. Abgleich mit dem Google Kalender
8. Erstellen oder Aktualisieren von Kalendereinträgen
9. optionales Löschen veralteter Einträge
10. Speichern von Debug- und Laufdaten

## Besonderheiten des Skripts

### Wochennavigation

Das Skript lädt die Crunchyroll-Seite nicht nur einmal, sondern navigiert wochenweise über:

```text
?filter=premium&date=YYYY-MM-DD
```

### Synchronisationszeitraum

Standardmäßig:

- **4 Wochen Vergangenheit**
- **aktuelle Woche**
- **Zukunft**, bis eine Woche nur noch `Zeitplan kommt bald` enthält
- zusätzlich abgesichert durch ein festes Zukunftslimit im Code

### Dublettenprüfung

Dubletten werden **nicht** über interne IDs erkannt, sondern direkt im Zielkalender über:

- **Serienname**
- **Startzeit**

Damit bleibt die Erkennung robust, selbst wenn sich Beschreibung oder Zusatzinformationen im Titel ändern.

### Sprach-/Dub-Filter

Das Skript kann Einträge anhand erkannter Begriffe filtern, zum Beispiel:

- `deutsch`
- `german dub`
- `english dub`
- `omu`
- `sub`
- `dub`

Damit lässt sich das Skript auf bestimmte Sprachvarianten einschränken.

### ICS-Endpunkt

Zusätzlich kann das Skript per `doGet()` einen ICS-ähnlichen Kalender-Feed bereitstellen. Das ist nützlich, wenn Einträge nicht direkt in Google Kalender geschrieben, sondern von anderen Systemen abonniert werden sollen.

---

## Wichtige Konfiguration

Die Konfiguration erfolgt über den `CONFIG`-Block im Skript.

Wichtige Werte sind unter anderem:

- `SOURCE_URL_BASE` – Basis-URL des Crunchyroll-Kalenders
- `TIMEZONE` – Zeitzone, typischerweise `Europe/Berlin`
- `CALENDAR_NAME` – Name des Zielkalenders
- `EVENT_DURATION_MINUTES` – Standarddauer eines Eintrags
- `PAST_WEEKS_TO_SYNC` – Anzahl vergangener Wochen
- `FUTURE_WEEKS_HARD_LIMIT` – Sicherheitsgrenze für Zukunftswochen
- `STOP_AFTER_FIRST_COMING_SOON_WEEK` – Abbruch, wenn nur noch „Zeitplan kommt bald“ vorkommt
- `DELETE_STALE_EVENTS` – veraltete Einträge löschen oder behalten
- `LANGUAGE_FILTER` – Include/Exclude-Regeln für Sprachinformationen

### Beispiel: nur deutsche Dubs zulassen

```javascript
LANGUAGE_FILTER: {
  enabled: true,
  include: ['deutsch', 'de dub', 'ger dub', 'german dub'],
  exclude: ['english dub', 'en dub'],
  allowIfNoLanguageInfo: false,
}
```

### Beispiel: alles zulassen, aber englische Dubs ausschließen

```javascript
LANGUAGE_FILTER: {
  enabled: true,
  include: [],
  exclude: ['english dub', 'en dub'],
  allowIfNoLanguageInfo: true,
}
```

---

## Wichtige Funktionen des Skripts

### `setupCrunchyrollSync()`

Komplett-Setup für den ersten Einsatz.

Führt aus:

- Zielkalender anlegen oder finden
- täglichen Trigger installieren
- ersten Synchronisationslauf starten

Empfohlen für die Erstinbetriebnahme.

### `syncCrunchyrollCalendar()`

Hauptfunktion für den regulären täglichen Lauf.

Diese Funktion:

- lädt den Crunchyroll-Kalender,
- parst alle relevanten Wochen,
- prüft vorhandene Kalendereinträge,
- erstellt oder aktualisiert Termine,
- schreibt Debug-Informationen.

### `debugParseOnly()`

Diagnosefunktion.

Diese Funktion:

- lädt und parst die Daten,
- schreibt **nichts** in den Google Kalender,
- ist ideal zum Testen nach Parser-Änderungen oder Website-Änderungen.

### `showLastDebugSummary()`

Zeigt die gespeicherten Debug-Informationen des letzten Laufs an.

Nützlich zur Fehleranalyse ohne erneuten Durchlauf.

### `installDailyTrigger()`

Legt einen täglichen Zeit-Trigger für `syncCrunchyrollCalendar()` an.

### `removeDailyTrigger()`

Entfernt den automatischen Trigger wieder.

### `purgeManagedCrunchyrollEvents()`

Löscht alle durch dieses Skript verwalteten Crunchyroll-Einträge aus dem Zielkalender.

Nützlich für Reset- oder Testzwecke.

### `doGet(e)`

Web-Endpunkt des Skripts.

Unterstützte Varianten:

- `?format=json`
- `?format=ics`
- ohne Parameter: JSON

---

## Einrichtung in Google Apps Script

### 1. Neues Projekt anlegen

1. Google Apps Script öffnen
2. neues Projekt erstellen
3. Inhalt aus `Apps/CalendarSync/Crunchyroll-Calendar-Sync.gs` einfügen
4. Projekt speichern

### 2. Zeitzone setzen

In den Projekteinstellungen die Zeitzone auf `Europe/Berlin` setzen.

### 3. Erster Testlauf

Empfohlene Reihenfolge:

1. `debugParseOnly()`
2. `setupCrunchyrollSync()`

Beim ersten Lauf fordert Google Berechtigungen an. Diese müssen bestätigt werden.

### 4. Automatische Ausführung

Nach `setupCrunchyrollSync()` ist der tägliche Trigger bereits angelegt.

Alternativ kann der Trigger manuell in der Apps-Script-Oberfläche angelegt werden:

1. links **Trigger** öffnen
2. **Trigger hinzufügen**
3. Funktion `syncCrunchyrollCalendar`
4. Ereignisquelle: **Zeitgesteuert**
5. Frequenz: **Täglich**

---

## Verwendung als Web-App / ICS-Feed

Wenn das Skript als Web-App bereitgestellt wird, kann der `doGet()`-Endpunkt genutzt werden.

### Beispielaufrufe

JSON:

```text
.../exec?format=json
```

ICS:

```text
.../exec?format=ics
```

### Bereitstellung

1. **Bereitstellen** → **Neue Bereitstellung**
2. Typ: **Web-App**
3. Ausführen als: eigenes Konto
4. Zugriff passend auswählen

---

## Logging und Fehleranalyse

Das Skript schreibt Debug-Informationen an mehreren Stellen:

- `Logger.log(...)`
- `CR_LAST_RUN_SUMMARY` in Script Properties
- `CR_LAST_RUN_HISTORY` in Script Properties

Fehleranalyse erfolgt über:

- **Ausführungen** in Google Apps Script
- `showLastDebugSummary()`
- `debugParseOnly()`

### Typische Fehlerursachen

- Crunchyroll ändert die HTML-/Textstruktur der Kalenderseite
- Sprache / Standort / Region liefern andere Seitentexte
- Google-Berechtigungen wurden noch nicht bestätigt
- Trigger wurde gelöscht oder ist fehlerhaft konfiguriert
- der Parser findet neue oder geänderte Label nicht mehr

---

## Grenzen / Hinweise

- Das Skript basiert auf dem sichtbaren Seiteninhalt der Crunchyroll-Kalenderseite.
- Änderungen an Markup, Texten oder Navigationslogik können Parser-Anpassungen notwendig machen.
- Die Datenquelle ist nicht als offizielle API dokumentiert.
- Künftige Sprach-/Dub-Erkennung hängt davon ab, welche Hinweise Crunchyroll im Seitentext bereitstellt.

---

## Empfohlener Betriebsablauf

Für produktiven Einsatz:

1. `debugParseOnly()` nach Änderungen testen
2. `setupCrunchyrollSync()` einmalig ausführen
3. täglichen Trigger laufen lassen
4. regelmäßig `showLastDebugSummary()` prüfen, wenn Probleme vermutet werden

Für größere Umbauten oder nach Parser-Fehlern:

1. `removeDailyTrigger()`
2. Code anpassen
3. `debugParseOnly()`
4. optional `purgeManagedCrunchyrollEvents()`
5. `setupCrunchyrollSync()` erneut starten

---

## Erweiterungsideen

Mögliche spätere Erweiterungen für dieses Repository oder speziell für das Crunchyroll-Skript:

- getrennte Kalender für Dub / Sub / OMU
- Farbzuweisung je nach Sprachvariante
- Benachrichtigungen bei neuen Einträgen
- zusätzliche Quellen neben Crunchyroll
- Export weiterer Datenformate
- zentrales gemeinsames Utility-Modul für Logging, Trigger und Web-Endpoints