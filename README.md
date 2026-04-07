# google-scripts-collection

Eine Sammlung von Google-Apps-Script-Projekten für Automatisierung, Synchronisation und Integration mit Google-Diensten wie Kalender, Mail, Drive oder externen Webquellen.

Das Repository dient als zentrale Ablage für wiederverwendbare Skripte, Prototypen und produktiv nutzbare Automatisierungen. Jedes Skript liegt in einem eigenen Verzeichnis und kann unabhängig gepflegt, erweitert und in ein separates Google-Apps-Script-Projekt übernommen werden.

## Ziel des Repositories

Dieses Repository bündelt Google-Apps-Script-Lösungen für wiederkehrende Aufgaben, zum Beispiel:

- Synchronisation externer Datenquellen mit Google-Diensten
- Kalender-Importe und Kalenderpflege
- geplante Jobs über zeitgesteuerte Trigger
- Bereitstellung einfacher Web-Endpunkte über `doGet()` / `doPost()`
- Debug- und Hilfsskripte für Administration und Diagnose

## Struktur

Die genaue Struktur kann mit der Zeit wachsen. Aktuell liegt das Crunchyroll-Kalender-Skript unter:

```text
Apps/
  CalendarSync/
    Crunchyroll-Calendar-Sync.gs
```

Empfohlen ist, zukünftige Skripte ähnlich zu organisieren, zum Beispiel nach Funktionsbereich:

- `Apps/CalendarSync/` für Kalendersynchronisationen
- `Apps/Mail/` für Mail-bezogene Automationen
- `Apps/Drive/` für Drive- oder Dateioperationen
- `Apps/Utilities/` für allgemeine Hilfsskripte

## Allgemeine Verwendung

### 1. Skript aus dem Repository übernehmen

Ein `.gs`-Skript aus diesem Repository wird in der Regel in ein eigenes Google-Apps-Script-Projekt kopiert.

Typischer Ablauf:

1. Google Apps Script öffnen
2. neues Projekt anlegen
3. Inhalt der gewünschten `.gs`-Datei übernehmen
4. Projekt speichern
5. Projekt-Zeitzone korrekt setzen
6. einmal manuell ausführen, damit Google die notwendigen Berechtigungen anfordert

### 2. Trigger / automatische Ausführung

Viele Skripte in diesem Repository sind so aufgebaut, dass sie entweder:

- manuell gestartet werden können,
- über einen installierbaren Zeit-Trigger laufen,
- oder als Web-App mit `doGet()` / `doPost()` veröffentlicht werden.

### 3. Logging / Debugging

Die Skripte verwenden typischerweise:

- `Logger.log(...)`
- strukturierte Debug-Historien
- Zusammenfassungen des letzten Laufs in `Script Properties`

So lassen sich Fehler in der Google-Apps-Script-Oberfläche unter **Ausführungen** und über spezielle Debug-Funktionen nachvollziehen.

