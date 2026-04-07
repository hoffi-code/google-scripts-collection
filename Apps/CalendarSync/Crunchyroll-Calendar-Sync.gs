/************************************************************
 * Crunchyroll Simulcast Calendar Sync for Google Apps Script
 *
 * Basis:
 *   https://www.crunchyroll.com/de/simulcastcalendar?filter=premium
 *
 * Features:
 * - eigener Google-Kalender
 * - täglicher Sync per Trigger
 * - Wochennavigation über &date=YYYY-MM-DD (Montag der Woche)
 * - Rückblick über definierte Anzahl Wochen
 * - Zukunft bis erste "Zeitplan kommt bald"-Woche
 * - Dublettenprüfung direkt im Google Kalender:
 *      Serienname + Startzeit
 * - optionales Löschen veralteter Einträge
 * - optionaler ICS-Endpunkt via doGet()
 * - Sprach-/Dub-Filter
 * - ausführliche Logs / Debug-Infos
 ************************************************************/

const CONFIG = {
  SOURCE_URL_BASE: 'https://www.crunchyroll.com/de/simulcastcalendar?filter=premium',
  TIMEZONE: 'Europe/Berlin',

  CALENDAR_NAME: 'Crunchyroll Premium Simulcast',
  CALENDAR_DESCRIPTION: 'Automatisch aus Crunchyroll Simulcast-Kalender synchronisiert',
  EVENT_DURATION_MINUTES: 30,

  // Rückblick: komplette Wochen vor aktueller Woche
  PAST_WEEKS_TO_SYNC: 1,

  // Zukunft: Sicherheitsgrenze
  FUTURE_WEEKS_HARD_LIMIT: 12,

  // Zukunftsabbruch sobald erste Woche nur "Zeitplan kommt bald" enthält
  STOP_AFTER_FIRST_COMING_SOON_WEEK: true,

  // Wenn true, werden verwaltete Kalendereinträge im relevanten Fenster gelöscht,
  // die nicht mehr im aktuellen Abruf vorkommen
  DELETE_STALE_EVENTS: false,

  EVENT_TAG: '[CR-SYNC]',
  EVENT_SOURCE_NAME: 'Crunchyroll Simulcast Premium',

  MAX_DEBUG_HISTORY_CHARS: 25000,

  FETCH_TIMEOUT_RETRIES: 2,
  USER_AGENT: 'Mozilla/5.0 (compatible; GoogleAppsScript Crunchyroll Calendar Sync; +https://script.google.com/)',

  ICS_FILENAME: 'crunchyroll-premium.ics',

  // Sprach-/Dub-Filter
  LANGUAGE_FILTER: {
    enabled: true,

    // Beispiele:
    // include: ['deutsch', 'de dub', 'ger dub', 'german dub'],
    include: [],

    // Beispiele:
    // exclude: ['english dub', 'en dub'],
    exclude: [],

    // Wenn true: Eintrag ohne erkennbare Sprachinfo bleibt erlaubt
    allowIfNoLanguageInfo: true,
  },

  // Dublettenprüfung
  DUPLICATE_MATCH: {
    searchWindowMinutes: 5,
  },
};

/* =========================
 * Öffentliche Funktionen
 * ========================= */

/**
 * Hauptfunktion für täglichen Sync
 */
function syncCrunchyrollCalendar() {
  const run = createRunContext_('syncCrunchyrollCalendar');

  try {
    logInfo_(run, 'SYNC_START', {
      sourceUrlBase: CONFIG.SOURCE_URL_BASE,
      pastWeeks: CONFIG.PAST_WEEKS_TO_SYNC,
      futureWeeksHardLimit: CONFIG.FUTURE_WEEKS_HARD_LIMIT,
      stopAfterComingSoonWeek: CONFIG.STOP_AFTER_FIRST_COMING_SOON_WEEK,
    });

    const calendar = getOrCreateCalendar_();
    logInfo_(run, 'CALENDAR_READY', {
      calendarName: calendar.getName(),
      calendarId: calendar.getId(),
    });

    const result = fetchAndParseCrunchyroll_(run);
    const entries = result.entries;

    logInfo_(run, 'PARSE_DONE', {
      entryCount: entries.length,
      fetchedAt: result.fetchedAtIso,
      weeks: result.weeks,
    });

    const syncStats = upsertEntriesIntoCalendar_(calendar, entries, run);

    let staleStats = { deleted: 0, staleCandidates: 0 };
    if (CONFIG.DELETE_STALE_EVENTS) {
      staleStats = deleteStaleCrunchyrollEvents_(calendar, entries, result, run);
    }

    const summary = {
      ok: true,
      fetchedAt: result.fetchedAtIso,
      entriesParsed: entries.length,
      created: syncStats.created,
      updated: syncStats.updated,
      unchanged: syncStats.unchanged,
      skipped: syncStats.skipped,
      deleted: staleStats.deleted,
      staleCandidates: staleStats.staleCandidates,
      calendarId: calendar.getId(),
      calendarName: calendar.getName(),
      lastError: null,
      weeks: result.weeks,
    };

    saveLastRunSummary_(summary, run);
    logInfo_(run, 'SYNC_FINISHED', summary);
    flushRunContext_(run);

    return summary;
  } catch (error) {
    const err = toErrorObject_(error);
    logError_(run, 'SYNC_FAILED', err);

    const summary = {
      ok: false,
      entriesParsed: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      deleted: 0,
      staleCandidates: 0,
      lastError: err,
    };

    saveLastRunSummary_(summary, run);
    flushRunContext_(run);
    throw error;
  }
}

/**
 * Testlauf: lädt alle Wochen, parst nur, schreibt nichts in Kalender
 */
function debugParseOnly() {
  const run = createRunContext_('debugParseOnly');

  try {
    const result = fetchAndParseCrunchyroll_(run);
    const preview = result.entries.slice(0, 30);

    logInfo_(run, 'DEBUG_PARSE_PREVIEW', {
      entryCount: result.entries.length,
      preview: preview,
      weeks: result.weeks,
    });

    saveLastRunSummary_(
      {
        ok: true,
        mode: 'parse-only',
        fetchedAt: result.fetchedAtIso,
        entriesParsed: result.entries.length,
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        deleted: 0,
        staleCandidates: 0,
        lastError: null,
        weeks: result.weeks,
      },
      run
    );

    flushRunContext_(run);
    return preview;
  } catch (error) {
    logError_(run, 'DEBUG_PARSE_FAILED', toErrorObject_(error));
    flushRunContext_(run);
    throw error;
  }
}

/**
 * Täglichen Trigger installieren
 */
function installDailyTrigger() {
  removeTriggersForFunction_('syncCrunchyrollCalendar');

  ScriptApp.newTrigger('syncCrunchyrollCalendar')
    .timeBased()
    .everyDays(1)
    .atHour(7)
    .create();

  Logger.log('Täglicher Trigger für syncCrunchyrollCalendar wurde erstellt.');
}

/**
 * Trigger entfernen
 */
function removeDailyTrigger() {
  removeTriggersForFunction_('syncCrunchyrollCalendar');
  Logger.log('Trigger für syncCrunchyrollCalendar wurden entfernt.');
}

/**
 * Komplett-Setup
 */
function setupCrunchyrollSync() {
  const calendar = getOrCreateCalendar_();
  installDailyTrigger();
  const result = syncCrunchyrollCalendar();

  return {
    calendarId: calendar.getId(),
    calendarName: calendar.getName(),
    syncResult: result,
  };
}

/**
 * Letzte Debug-Daten anzeigen
 */
function showLastDebugSummary() {
  const props = PropertiesService.getScriptProperties();
  const summary = props.getProperty('CR_LAST_RUN_SUMMARY');
  const history = props.getProperty('CR_LAST_RUN_HISTORY');

  Logger.log('=== CR_LAST_RUN_SUMMARY ===\n%s', summary || '(leer)');
  Logger.log('=== CR_LAST_RUN_HISTORY ===\n%s', history || '(leer)');

  return {
    summary: summary ? JSON.parse(summary) : null,
    history: history || null,
  };
}

/**
 * Alle von diesem Script verwalteten CR-Events löschen
 */
function purgeManagedCrunchyrollEvents() {
  const calendar = getOrCreateCalendar_();
  const run = createRunContext_('purgeManagedCrunchyrollEvents');

  const start = new Date(2020, 0, 1);
  const end = new Date(2035, 0, 1);
  const events = calendar.getEvents(start, end);

  let deleted = 0;
  events.forEach((event) => {
    const desc = event.getDescription() || '';
    if (desc.indexOf(CONFIG.EVENT_TAG) >= 0) {
      try {
        event.deleteEvent();
        deleted++;
      } catch (e) {
        logError_(run, 'PURGE_DELETE_FAILED', {
          title: safeGet_(() => event.getTitle()),
          error: String(e),
        });
      }
    }
  });

  logInfo_(run, 'PURGE_DONE', { deleted });
  flushRunContext_(run);

  return { deleted };
}

/**
 * Web-App Endpoint
 *   ?format=ics  -> iCalendar Text
 *   ?format=json -> JSON
 *   ohne Parameter -> JSON
 */
function doGet(e) {
  const run = createRunContext_('doGet');

  try {
    const format = ((e && e.parameter && e.parameter.format) || 'json').toLowerCase();
    const result = fetchAndParseCrunchyroll_(run);

    if (format === 'ics') {
      const ics = buildIcs_(result.entries, run);
      logInfo_(run, 'DOGET_ICS_OK', { entryCount: result.entries.length });
      flushRunContext_(run);

      return ContentService
        .createTextOutput(ics)
        .setMimeType(ContentService.MimeType.TEXT);
    }

    const payload = {
      ok: true,
      sourceUrlBase: CONFIG.SOURCE_URL_BASE,
      fetchedAt: result.fetchedAtIso,
      entryCount: result.entries.length,
      weeks: result.weeks,
      entries: result.entries,
    };

    logInfo_(run, 'DOGET_JSON_OK', { entryCount: result.entries.length });
    flushRunContext_(run);

    return ContentService
      .createTextOutput(JSON.stringify(payload, null, 2))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    const err = toErrorObject_(error);
    logError_(run, 'DOGET_FAILED', err);
    flushRunContext_(run);

    return ContentService
      .createTextOutput(
        JSON.stringify(
          {
            ok: false,
            error: err,
          },
          null,
          2
        )
      )
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/* =========================
 * Fetch / Parse
 * ========================= */

function fetchAndParseCrunchyroll_(run) {
  const fetchedAt = new Date();
  const now = new Date();

  const thisMonday = getWeekStartMonday_(now);
  const firstMonday = addDays_(thisMonday, -7 * CONFIG.PAST_WEEKS_TO_SYNC);

  let allEntries = [];
  const weekResults = [];

  const totalWeeksToAttempt = CONFIG.PAST_WEEKS_TO_SYNC + CONFIG.FUTURE_WEEKS_HARD_LIMIT + 1;

  for (let weekOffset = 0; weekOffset < totalWeeksToAttempt; weekOffset++) {
    const monday = addDays_(firstMonday, weekOffset * 7);
    const url = buildCrunchyrollWeekUrl_(monday);

    logInfo_(run, 'FETCH_WEEK_START', {
      mondayIso: monday.toISOString(),
      url,
      weekOffset,
    });

    const html = fetchUrlWithRetry_(url, run);
    const text = htmlToVisibleText_(html);

    logInfo_(run, 'FETCH_WEEK_TEXT_READY', {
      mondayIso: monday.toISOString(),
      textLength: text.length,
      textSample: text.substring(0, 500),
    });

    const parseResult = parseCrunchyrollVisibleTextWithWeekMeta_(text, monday, run);

    weekResults.push({
      mondayIso: monday.toISOString(),
      url: url,
      entryCount: parseResult.entries.length,
      hasAnyComingSoon: parseResult.hasAnyComingSoon,
      hasComingSoonOnly: parseResult.hasComingSoonOnly,
    });

    allEntries = allEntries.concat(parseResult.entries);

    const isFutureOrCurrentWeek = monday.getTime() >= thisMonday.getTime();

    if (
      isFutureOrCurrentWeek &&
      CONFIG.STOP_AFTER_FIRST_COMING_SOON_WEEK &&
      parseResult.hasComingSoonOnly
    ) {
      logInfo_(run, 'STOP_FUTURE_SCAN_AT_COMING_SOON_WEEK', {
        mondayIso: monday.toISOString(),
        url,
      });
      break;
    }
  }

  allEntries = dedupeParsedEntriesBySeriesAndStart_(allEntries);

  logInfo_(run, 'FETCH_AND_PARSE_ALL_WEEKS_DONE', {
    totalEntries: allEntries.length,
    weeks: weekResults,
  });

  return {
    fetchedAtIso: fetchedAt.toISOString(),
    entries: allEntries,
    weeks: weekResults,
    scanWindow: {
      firstMondayIso: firstMonday.toISOString(),
      currentMondayIso: thisMonday.toISOString(),
    },
  };
}

function fetchUrlWithRetry_(url, run) {
  let lastError = null;

  for (let attempt = 1; attempt <= CONFIG.FETCH_TIMEOUT_RETRIES + 1; attempt++) {
    try {
      logInfo_(run, 'FETCH_ATTEMPT', { attempt, url });

      const response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
      });

      const code = response.getResponseCode();
      const body = response.getContentText();

      logInfo_(run, 'FETCH_RESPONSE', {
        attempt,
        responseCode: code,
        bodyLength: body.length,
      });

      if (code >= 200 && code < 300) {
        if (!body || body.trim().length < 100) {
          throw new Error('Leere oder zu kurze HTML-Antwort erhalten.');
        }
        return body;
      }

      throw new Error('HTTP-Fehler: ' + code + ' beim Abruf von ' + url);
    } catch (error) {
      lastError = error;
      logError_(run, 'FETCH_ATTEMPT_FAILED', {
        attempt,
        error: toErrorObject_(error),
      });

      Utilities.sleep(800 * attempt);
    }
  }

  throw lastError || new Error('Unbekannter Fehler beim Abruf der URL.');
}

function htmlToVisibleText_(html) {
  let s = String(html || '');

  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n');
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n');
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '\n');

  s = s.replace(/<\/?(div|section|article|header|footer|nav|aside|main|ul|ol|li|p|br|h1|h2|h3|h4|h5|h6)\b[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');

  s = decodeHtmlEntities_(s);
  s = s.replace(/\u00A0/g, ' ');
  s = s.replace(/\r/g, '\n');
  s = s.replace(/\t/g, ' ');
  s = s.replace(/[ ]{2,}/g, ' ');
  s = s.replace(/\n[ ]+/g, '\n');
  s = s.replace(/[ ]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}

function parseCrunchyrollVisibleTextWithWeekMeta_(text, weekMonday, run) {
  const lines = text
    .split('\n')
    .map((x) => cleanupText_(x))
    .filter((x) => x);

  logInfo_(run, 'PARSE_LINES_READY', {
    mondayIso: weekMonday.toISOString(),
    lineCount: lines.length,
    firstLines: lines.slice(0, 80),
  });

  const entries = [];
  let hasAnyComingSoon = false;

  let currentMonth = null;
  let currentDay = null;
  let currentDate = null;
  const year = getReasonableCalendarYear_();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const dateMatch = line.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (dateMatch) {
      currentMonth = parseInt(dateMatch[1], 10);
      currentDay = parseInt(dateMatch[2], 10);
      currentDate = makeDateWithYearCorrection_(year, currentMonth, currentDay);

      logInfo_(run, 'DAY_MARKER', {
        lineIndex: i,
        line,
        currentDateIso: currentDate.toISOString(),
        mondayIso: weekMonday.toISOString(),
      });
      continue;
    }

    if (/^Zeitplan kommt bald$/i.test(line) || /^Schedule Coming Soon$/i.test(line)) {
      hasAnyComingSoon = true;
      continue;
    }

    if (
      line === 'Premium-Episoden' ||
      line === 'Kostenlose neue Episoden' ||
      line === 'Letzte Woche' ||
      line === 'Nächste Woche' ||
      line === 'Premium Episodes' ||
      line === 'Free New Episodes' ||
      line === 'Last Week' ||
      line === 'Next Week'
    ) {
      continue;
    }

    if (currentDate && isTimeLine_(line)) {
      const timeText = line;
      const seriesTitle = findNextMeaningfulTitleLine_(lines, i + 1);
      const availability = findAvailabilityLine_(lines, i + 1);
      const episodeDetail = findEpisodeDetailLine_(lines, i + 1);
      const languageInfo = extractLanguageInfo_(seriesTitle, availability, episodeDetail);

      if (!seriesTitle) {
        logInfo_(run, 'ENTRY_SKIPPED_NO_TITLE', {
          mondayIso: weekMonday.toISOString(),
          lineIndex: i,
          timeText,
        });
        continue;
      }

      const start = combineDateAndTime_(currentDate, timeText);
      const end = new Date(start.getTime() + CONFIG.EVENT_DURATION_MINUTES * 60000);

      const entry = {
        title: buildEventTitle_(seriesTitle, availability, episodeDetail, languageInfo),
        seriesTitle: seriesTitle,
        availability: availability || '',
        episodeDetail: episodeDetail || '',
        languageInfo: languageInfo || '',
        sourceUrl: buildCrunchyrollWeekUrl_(weekMonday),
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        startMillis: start.getTime(),
        endMillis: end.getTime(),
        timeText: timeText,
        dateKey: formatDateKey_(currentDate),
        location: 'Crunchyroll',
        description: buildEventDescription_({
          title: seriesTitle,
          availability,
          episodeDetail,
          timeText,
          start,
          languageInfo,
        }),
      };

      if (!passesLanguageFilter_(entry, run)) {
        logInfo_(run, 'ENTRY_FILTERED_BY_LANGUAGE', {
          mondayIso: weekMonday.toISOString(),
          lineIndex: i,
          entry,
        });
        continue;
      }

      entries.push(entry);

      logInfo_(run, 'ENTRY_PARSED', {
        mondayIso: weekMonday.toISOString(),
        lineIndex: i,
        entry,
      });
    }
  }

  entries.sort((a, b) => a.startMillis - b.startMillis || a.title.localeCompare(b.title));

  const result = {
    entries,
    hasAnyComingSoon,
    hasComingSoonOnly: hasAnyComingSoon && entries.length === 0,
  };

  logInfo_(run, 'PARSE_WEEK_FINISHED', {
    mondayIso: weekMonday.toISOString(),
    entryCount: result.entries.length,
    hasAnyComingSoon: result.hasAnyComingSoon,
    hasComingSoonOnly: result.hasComingSoonOnly,
  });

  return result;
}

function dedupeParsedEntriesBySeriesAndStart_(entries) {
  const map = new Map();

  entries.forEach((entry) => {
    const key =
      normalizeTitleForDuplicateMatch_(entry.seriesTitle) +
      '|' +
      new Date(entry.startIso).getTime();

    if (!map.has(key)) {
      map.set(key, entry);
    }
  });

  return Array.from(map.values()).sort((a, b) => a.startMillis - b.startMillis || a.title.localeCompare(b.title));
}

function findNextMeaningfulTitleLine_(lines, startIndex) {
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 15); i++) {
    const line = lines[i];
    if (!line) continue;

    if (
      line === 'In Queue' ||
      line === 'Premiere' ||
      line === 'Heute' ||
      line === 'Mo' ||
      line === 'Di' ||
      line === 'Mi' ||
      line === 'Do' ||
      line === 'Fr' ||
      line === 'Sa' ||
      line === 'So' ||
      line === 'Zeitplan kommt bald' ||
      line === 'Schedule Coming Soon'
    ) {
      continue;
    }

    if (isTimeLine_(line)) return null;
    if (isAvailabilityLine_(line)) continue;
    if (looksLikeNavigationLine_(line)) continue;

    return line;
  }
  return null;
}

function findAvailabilityLine_(lines, startIndex) {
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 12); i++) {
    const line = lines[i];
    if (isAvailabilityLine_(line)) return line;
    if (isTimeLine_(line)) return null;
  }
  return '';
}

function findEpisodeDetailLine_(lines, startIndex) {
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 16); i++) {
    const line = lines[i];

    if (!line) continue;
    if (line === 'In Queue' || line === 'Premiere') continue;

    if (/Video abspielen/i.test(line)) {
      let cleaned = line
        .replace(/^Premiere\s*/i, '')
        .replace(/\bVideo abspielen\b/gi, '')
        .replace(/\bNur für Premium\b/gi, '')
        .replace(/\bFortschritt:\s*\d+\s*%\b/gi, '')
        .trim();

      cleaned = cleaned.replace(/^\d+\s+/, '').trim();

      return cleaned;
    }

    if (isTimeLine_(line)) return '';
  }
  return '';
}

function isAvailabilityLine_(line) {
  return /\bFolge\b|\bFolgen\b/i.test(line) && /\bVerfügbar\b/i.test(line);
}

function isTimeLine_(line) {
  return /^\d{1,2}:\d{2}(am|pm)?$/i.test(line);
}

function looksLikeNavigationLine_(line) {
  return /^(Einloggen|Konto erstellen|Veröffentlichungskalender|Winter \d{4} Lineup|Hol dir Premium|Beliebte Serien|Plattformen und Geräte|Premium-Mitgliedschaft|Sprache|Kundendienst|Crunchyroll|Last Week|Next Week)$/i.test(
    line
  );
}

/* =========================
 * Sprach-/Dub-Filter
 * ========================= */

function extractLanguageInfo_(seriesTitle, availability, episodeDetail) {
  const text = [seriesTitle, availability, episodeDetail]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();

  const hits = [];

  const patterns = [
    'deutsch',
    'german',
    'ger dub',
    'de dub',
    'german dub',
    'english dub',
    'en dub',
    'japanese',
    'japanisch',
    'omu',
    'sub',
    'dub',
    'simulcast',
    'simuldub',
  ];

  patterns.forEach((p) => {
    if (text.indexOf(p) >= 0) hits.push(p);
  });

  return hits.join(', ');
}

function passesLanguageFilter_(entry, run) {
  const cfg = CONFIG.LANGUAGE_FILTER;
  if (!cfg || !cfg.enabled) return true;

  const haystack = [
    entry.title,
    entry.seriesTitle,
    entry.availability,
    entry.episodeDetail,
    entry.languageInfo,
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();

  const include = (cfg.include || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
  const exclude = (cfg.exclude || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);

  const hasAnyLanguageInfo = !!cleanupText_(entry.languageInfo);

  for (let i = 0; i < exclude.length; i++) {
    if (haystack.indexOf(exclude[i]) >= 0) {
      logInfo_(run, 'LANGUAGE_FILTER_EXCLUDE_MATCH', {
        exclude: exclude[i],
        title: entry.title,
      });
      return false;
    }
  }

  if (include.length === 0) {
    if (!hasAnyLanguageInfo && !cfg.allowIfNoLanguageInfo) {
      return false;
    }
    return true;
  }

  for (let j = 0; j < include.length; j++) {
    if (haystack.indexOf(include[j]) >= 0) {
      return true;
    }
  }

  if (!hasAnyLanguageInfo && cfg.allowIfNoLanguageInfo) {
    return true;
  }

  return false;
}

/* =========================
 * Kalender Sync
 * ========================= */

function upsertEntriesIntoCalendar_(calendar, entries, run) {
  const stats = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  };

  entries.forEach((entry) => {
    try {
      const existingEvent = findExistingEventBySeriesAndStart_(calendar, entry, run);

      if (!existingEvent) {
        const event = calendar.createEvent(
          entry.title,
          new Date(entry.startIso),
          new Date(entry.endIso),
          {
            description: entry.description,
            location: entry.location,
          }
        );

        stats.created++;

        logInfo_(run, 'EVENT_CREATED', {
          eventId: event.getId(),
          title: entry.title,
          seriesTitle: entry.seriesTitle,
          startIso: entry.startIso,
        });
        return;
      }

      const changes = diffEvent_(existingEvent, entry);

      if (!changes.hasChanges) {
        stats.unchanged++;

        logInfo_(run, 'EVENT_UNCHANGED', {
          eventId: existingEvent.getId(),
          title: entry.title,
          seriesTitle: entry.seriesTitle,
          startIso: entry.startIso,
        });
        return;
      }

      applyEventChanges_(existingEvent, entry, changes, run);
      stats.updated++;

      logInfo_(run, 'EVENT_UPDATED', {
        eventId: existingEvent.getId(),
        title: entry.title,
        seriesTitle: entry.seriesTitle,
        startIso: entry.startIso,
        changes: changes,
      });
    } catch (error) {
      stats.skipped++;
      logError_(run, 'EVENT_UPSERT_FAILED', {
        title: entry.title,
        seriesTitle: entry.seriesTitle,
        startIso: entry.startIso,
        error: toErrorObject_(error),
      });
    }
  });

  return stats;
}

function findExistingEventBySeriesAndStart_(calendar, entry, run) {
  const start = new Date(entry.startIso);
  const end = new Date(entry.endIso);

  const windowMinutes = CONFIG.DUPLICATE_MATCH.searchWindowMinutes || 5;
  const windowStart = new Date(start.getTime() - windowMinutes * 60000);
  const windowEnd = new Date(end.getTime() + windowMinutes * 60000);

  const candidates = calendar.getEvents(windowStart, windowEnd);

  const wantedSeriesTitle = normalizeTitleForDuplicateMatch_(entry.seriesTitle);
  const wantedStartMillis = start.getTime();

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateTitle = normalizeTitleForDuplicateMatch_(candidate.getTitle() || '');
    const candidateStartMillis = candidate.getStartTime().getTime();

    if (
      candidateStartMillis === wantedStartMillis &&
      candidateTitle.indexOf(wantedSeriesTitle) === 0
    ) {
      logInfo_(run, 'DUPLICATE_MATCH_FOUND', {
        seriesTitle: entry.seriesTitle,
        startIso: entry.startIso,
        candidateEventId: candidate.getId(),
        candidateTitle: candidate.getTitle(),
      });
      return candidate;
    }
  }

  return null;
}

function normalizeTitleForDuplicateMatch_(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function diffEvent_(event, entry) {
  const currentTitle = event.getTitle() || '';
  const currentDescription = event.getDescription() || '';
  const currentLocation = event.getLocation() || '';

  const start = event.getStartTime();
  const end = event.getEndTime();

  const desiredStart = new Date(entry.startIso);
  const desiredEnd = new Date(entry.endIso);

  const changes = {
    titleChanged: currentTitle !== entry.title,
    descriptionChanged: currentDescription !== entry.description,
    locationChanged: currentLocation !== entry.location,
    startChanged: start.getTime() !== desiredStart.getTime(),
    endChanged: end.getTime() !== desiredEnd.getTime(),
  };

  changes.hasChanges =
    changes.titleChanged ||
    changes.descriptionChanged ||
    changes.locationChanged ||
    changes.startChanged ||
    changes.endChanged;

  return changes;
}

function applyEventChanges_(event, entry, changes, run) {
  if (changes.titleChanged) {
    event.setTitle(entry.title);
  }

  if (changes.descriptionChanged) {
    event.setDescription(entry.description);
  }

  if (changes.locationChanged) {
    event.setLocation(entry.location);
  }

  if (changes.startChanged || changes.endChanged) {
    event.setTime(new Date(entry.startIso), new Date(entry.endIso));
  }

  logInfo_(run, 'EVENT_CHANGES_APPLIED', {
    eventId: event.getId(),
    title: entry.title,
    seriesTitle: entry.seriesTitle,
    changes,
  });
}

function deleteStaleCrunchyrollEvents_(calendar, entries, result, run) {
  const activeKeys = {};
  entries.forEach((e) => {
    activeKeys[buildStaleKey_(e)] = true;
  });

  const firstMonday = new Date(result.scanWindow.firstMondayIso);
  const lastWeek = result.weeks && result.weeks.length
    ? new Date(result.weeks[result.weeks.length - 1].mondayIso)
    : new Date(result.scanWindow.currentMondayIso);

  const rangeStart = new Date(firstMonday.getTime());
  const rangeEnd = addDays_(lastWeek, 7);

  const events = calendar.getEvents(rangeStart, rangeEnd);

  let staleCandidates = 0;
  let deleted = 0;

  events.forEach((event) => {
    const desc = event.getDescription() || '';
    if (desc.indexOf(CONFIG.EVENT_TAG) < 0) return;

    const eventStart = event.getStartTime();
    const title = event.getTitle() || '';
    const seriesTitle = extractSeriesTitleFromEventTitle_(title);
    const key = buildStaleKeyFromValues_(seriesTitle, eventStart);

    if (!activeKeys[key]) {
      staleCandidates++;
      try {
        event.deleteEvent();
        deleted++;
        logInfo_(run, 'STALE_EVENT_DELETED', {
          title,
          seriesTitle,
          startIso: eventStart.toISOString(),
        });
      } catch (error) {
        logError_(run, 'STALE_DELETE_FAILED', {
          title,
          seriesTitle,
          startIso: eventStart.toISOString(),
          error: toErrorObject_(error),
        });
      }
    }
  });

  return { staleCandidates, deleted };
}

function buildStaleKey_(entry) {
  return buildStaleKeyFromValues_(entry.seriesTitle, new Date(entry.startIso));
}

function buildStaleKeyFromValues_(seriesTitle, start) {
  return normalizeTitleForDuplicateMatch_(seriesTitle) + '|' + start.getTime();
}

function extractSeriesTitleFromEventTitle_(title) {
  const idx = String(title || '').indexOf(' — ');
  if (idx < 0) return String(title || '').trim();
  return String(title || '').substring(0, idx).trim();
}

/* =========================
 * Kalender / Setup
 * ========================= */

function getOrCreateCalendar_() {
  const existing = CalendarApp.getCalendarsByName(CONFIG.CALENDAR_NAME);
  if (existing && existing.length > 0) {
    return existing[0];
  }

  const calendar = CalendarApp.createCalendar(CONFIG.CALENDAR_NAME, {
    summary: CONFIG.CALENDAR_NAME,
    description: CONFIG.CALENDAR_DESCRIPTION,
    timeZone: CONFIG.TIMEZONE,
  });

  return calendar;
}

/* =========================
 * Wochennavigation / Datumshelfer
 * ========================= */

function getWeekStartMonday_(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // So=0, Mo=1, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays_(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateForCrunchyroll_(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function buildCrunchyrollWeekUrl_(mondayDate) {
  return CONFIG.SOURCE_URL_BASE + '&date=' + formatDateForCrunchyroll_(mondayDate);
}

/* =========================
 * ICS
 * ========================= */

function buildIcs_(entries, run) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenAI//Crunchyroll Premium Sync//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeIcsText_(CONFIG.CALENDAR_NAME),
    'X-WR-TIMEZONE:' + CONFIG.TIMEZONE,
  ];

  entries.forEach((entry) => {
    const uid = buildIcsUid_(entry);

    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + escapeIcsText_(uid));
    lines.push('DTSTAMP:' + formatIcsDateUtc_(new Date()));
    lines.push('DTSTART:' + formatIcsDateUtc_(new Date(entry.startIso)));
    lines.push('DTEND:' + formatIcsDateUtc_(new Date(entry.endIso)));
    lines.push('SUMMARY:' + foldIcsLine_(escapeIcsText_(entry.title)));
    lines.push('DESCRIPTION:' + foldIcsLine_(escapeIcsText_(entry.description)));
    lines.push('LOCATION:' + foldIcsLine_(escapeIcsText_(entry.location || 'Crunchyroll')));
    lines.push('URL:' + escapeIcsText_(entry.sourceUrl));
    lines.push('STATUS:CONFIRMED');
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');

  logInfo_(run, 'ICS_BUILT', { entryCount: entries.length });
  return lines.join('\r\n');
}

function buildIcsUid_(entry) {
  const raw = normalizeTitleForDuplicateMatch_(entry.seriesTitle) + '|' + entry.startIso;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  const hex = digest.map(function (b) {
    const v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
  return hex + '@apps-script.local';
}

/* =========================
 * Hilfsfunktionen: Text / Datum
 * ========================= */

function decodeHtmlEntities_(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function (_, code) {
      return String.fromCharCode(parseInt(code, 10));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
}

function cleanupText_(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function combineDateAndTime_(dateObj, timeText) {
  const m = String(timeText).trim().match(/^(\d{1,2}):(\d{2})(am|pm)?$/i);
  if (!m) {
    throw new Error('Ungültige Uhrzeit: ' + timeText);
  }

  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const meridiem = (m[3] || '').toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return new Date(
    dateObj.getFullYear(),
    dateObj.getMonth(),
    dateObj.getDate(),
    hour,
    minute,
    0,
    0
  );
}

function getReasonableCalendarYear_() {
  return new Date().getFullYear();
}

function makeDateWithYearCorrection_(year, month, day) {
  const now = new Date();
  let d = new Date(year, month - 1, day, 0, 0, 0, 0);

  const diffDays = Math.round((d.getTime() - now.getTime()) / 86400000);

  if (diffDays < -180) {
    d = new Date(year + 1, month - 1, day, 0, 0, 0, 0);
  } else if (diffDays > 180) {
    d = new Date(year - 1, month - 1, day, 0, 0, 0, 0);
  }

  return d;
}

function formatDateKey_(dateObj) {
  return Utilities.formatDate(dateObj, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function buildEventTitle_(title, availability, episodeDetail, languageInfo) {
  const parts = [title];

  if (availability) parts.push('— ' + availability);
  if (episodeDetail) parts.push('— ' + episodeDetail);
  if (languageInfo) parts.push('[' + languageInfo + ']');

  return parts.join(' ');
}

function buildEventDescription_(data) {
  const lines = [
    CONFIG.EVENT_TAG + ' ' + CONFIG.EVENT_SOURCE_NAME,
    '',
    'Serie: ' + (data.title || ''),
    'Verfügbarkeit: ' + (data.availability || ''),
    'Details: ' + (data.episodeDetail || ''),
    'Sprache/Dub: ' + (data.languageInfo || ''),
    'Uhrzeit auf Seite: ' + (data.timeText || ''),
    'Quelle: ' + CONFIG.SOURCE_URL_BASE,
  ];

  return lines.join('\n');
}

function formatIcsDateUtc_(dateObj) {
  return Utilities.formatDate(dateObj, 'UTC', "yyyyMMdd'T'HHmmss'Z'");
}

function escapeIcsText_(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine_(s) {
  const max = 70;
  let out = '';
  let input = String(s || '');

  while (input.length > max) {
    out += input.substring(0, max) + '\r\n ';
    input = input.substring(max);
  }
  out += input;

  return out;
}

/* =========================
 * Logging / Debug
 * ========================= */

function createRunContext_(name) {
  return {
    name: name,
    startedAt: new Date(),
    history: [],
  };
}

function logInfo_(run, code, data) {
  const msg = '[' + new Date().toISOString() + '] INFO ' + code + ' ' + safeJson_(data);
  run.history.push(msg);
  Logger.log(msg);
}

function logError_(run, code, data) {
  const msg = '[' + new Date().toISOString() + '] ERROR ' + code + ' ' + safeJson_(data);
  run.history.push(msg);
  Logger.log(msg);
}

function flushRunContext_(run) {
  const props = PropertiesService.getScriptProperties();
  let history = run.history.join('\n');

  if (history.length > CONFIG.MAX_DEBUG_HISTORY_CHARS) {
    history = history.substring(history.length - CONFIG.MAX_DEBUG_HISTORY_CHARS);
  }

  props.setProperty('CR_LAST_RUN_HISTORY', history);
}

function saveLastRunSummary_(summary, run) {
  const props = PropertiesService.getScriptProperties();
  const payload = {
    ...summary,
    functionName: run.name,
    finishedAt: new Date().toISOString(),
  };
  props.setProperty('CR_LAST_RUN_SUMMARY', JSON.stringify(payload, null, 2));
}

function safeJson_(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj);
  }
}

function toErrorObject_(error) {
  return {
    name: safeGet_(() => error && error.name),
    message: safeGet_(() => error && error.message) || String(error),
    stack: safeGet_(() => error && error.stack) || null,
  };
}

function safeGet_(fn) {
  try {
    return fn();
  } catch (e) {
    return null;
  }
}

function removeTriggersForFunction_(functionName) {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach((trigger) => {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}