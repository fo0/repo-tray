import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'docs/review/screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 480, height: 760 },
  deviceScaleFactor: 2,
  locale: 'de-DE',
});
const page = await context.newPage();
/** @type {string[]} */
const externalRequests = [];
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    externalRequests.push(request.url());
});
/**
 * @type {{
 *   filename: string;
 *   title: string;
 *   interaction: string;
 *   expected: string;
 *   sha256: string;
 * }[]}
 */
const steps = [];
/**
 * @param {string} name
 * @param {string} title
 * @param {string} interaction
 * @param {string} expected
 */
async function capture(name, title, interaction, expected) {
  const filename = `${String(steps.length + 1).padStart(2, '0')}-${name}.png`;
  await page.screenshot({
    path: path.join(output, filename),
    animations: 'disabled',
  });
  const bytes = await readFile(path.join(output, filename));
  steps.push({
    filename,
    title,
    interaction,
    expected,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
async function launchTab() {
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
}
/** @param {string} name */
async function openPin(name) {
  const card = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
  await card.getByRole('button', { name: 'Öffnen', exact: true }).click();
  return page.getByRole('dialog', { name: 'Workflow starten' });
}
/** @param {string} value */
async function setScenario(value) {
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByLabel('Demo-Szenario').selectOption(value);
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
}
/** @param {import('@playwright/test').Locator} dialog */
async function bottom(dialog) {
  await dialog.locator('.modal-body').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}
try {
  await page.goto(process.env.REVIEW_BASE_URL ?? 'http://127.0.0.1:1420');
  await expect(
    page.getByRole('status', { name: 'Verbindungsstatus' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Einstellungen', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await capture(
    'aktivitaet',
    'Alle Repositories im Blick',
    'App öffnen → Aktivität mit Standardfilter Alle.',
    'Run-Verlauf mit vollem Owner, Workflow-Status und Branch. Ausschließlich Beispieldaten.',
  );

  await page.getByLabel('Account auswählen').selectOption('demo-work');
  await expect(
    page.getByText('example-org/runner-tools-demo', { exact: true }).first(),
  ).toBeVisible();
  await capture(
    'konto-wechsel',
    'Arbeitskonto gezielt ansehen',
    'Account auswählen → team-demo.',
    'Es erscheinen nur die ausgewählten Repositories dieses Demo-Kontos; Owner example-org bleibt erkennbar.',
  );

  await page.getByLabel('Account auswählen').selectOption('demo-personal');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await page
    .getByRole('button', { name: /Preview site · demo-dev\/website-demo/ })
    .click();
  await capture(
    'fehlerdetails',
    'Einen fehlgeschlagenen Run untersuchen',
    'Account demo-dev → Filter Fehlgeschlagen → Preview site aufklappen.',
    'Ergebnis und Konto sind sichtbar. Ein echter GitHub-Link wird für simulierte Runs nicht vorgetäuscht.',
  );

  await launchTab();
  await capture(
    'vorlagen',
    'Häufige Starts als Vorlagen',
    'Zur Ansicht Favoriten wechseln.',
    'Windows build ist angepinnt. Öffnen führt zunächst zur Bestätigung; Schnellstart ist standardmäßig aus.',
  );

  let dialog = await openPin('Windows build');
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByLabel('Build target').selectOption('linux-x64');
  await dialog.getByLabel('Version', { exact: true }).fill('0.2.0');
  await capture(
    'start-konfigurieren',
    'Branch und Parameter einstellen',
    'Vorlage öffnen → develop → linux-x64 → Version 0.2.0.',
    'Repository und Workflow bleiben eindeutig; Dry run bleibt eingeschaltet. Noch wurde nichts gestartet.',
  );

  await dialog.getByText('Als Vorlage speichern', { exact: true }).click();
  await dialog.getByLabel('Name der Vorlage').fill('Linux develop');
  await dialog
    .getByRole('button', { name: 'Als neue Vorlage speichern', exact: true })
    .click();
  await expect(
    dialog.getByText('Vorlage lokal gespeichert.', { exact: true }),
  ).toBeVisible();
  await bottom(dialog);
  await capture(
    'vorlage-speichern',
    'Eine Variante als neue Vorlage speichern',
    'Vorlagenbereich öffnen → Linux develop eingeben → Als neue Vorlage speichern.',
    'Die neue Variante wird lokal gespeichert; Windows build bleibt erhalten. Schnellstart bleibt aus, ein Start wird nicht ausgelöst. Der Dialog ist zum Speicherbereich gescrollt.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await capture(
    'vorlage-gespeichert',
    'Gespeicherte Auswahl wiederverwenden',
    'Dialog schließen.',
    'Linux develop erscheint mit dem gespeicherten Ref develop und einer Öffnen-Schaltfläche.',
  );

  dialog = await openPin('Linux develop');
  await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue(
    '0.2.0',
  );
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await bottom(dialog);
  await capture(
    'start-angenommen',
    'Startannahme mit konkreter Run-ID',
    'Gespeicherte Vorlage öffnen → Start simulieren.',
    'Genau Demo-Run #9001 wird angenommen. Der Startknopf ist gegen Doppelklick gesperrt; Annahme und Build-Erfolg werden getrennt.',
  );
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.getByRole('button', { name: /^Aktivität/ }).click();
  await page
    .getByRole('button', { name: 'Abgeschlossen', exact: true })
    .click();
  const newRun = page
    .locator('article.run')
    .filter({ has: page.getByText('#9001', { exact: true }) });
  await expect(newRun.getByRole('button')).toHaveAccessibleName(/Erfolgreich/, {
    timeout: 6000,
  });
  await newRun.getByRole('button').click();
  await capture(
    'run-verfolgen',
    'Diesen Run im Überblick verfolgen',
    'Nach Abschluss zur Aktivität wechseln → Abgeschlossen → #9001 aufklappen.',
    'Der konkrete neue Demo-Run zeigt develop, den erreichten Zustand und das Konto. Es handelt sich weiterhin um lokale Simulation.',
  );

  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await capture(
    'repo-auswahl',
    'Die beobachteten Repositories festlegen',
    'Einstellungen öffnen.',
    'Auswahl ist nach Konto gruppiert; voller Owner/Repo und Lese- beziehungsweise Schreibrecht sind sichtbar.',
  );
  await page.getByRole('button', { name: 'Dialog schließen' }).click();
  await setScenario('offline');
  await launchTab();
  dialog = await openPin('Windows build');
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await bottom(dialog);
  await capture(
    'offline',
    'Vorlagen offline öffnen, Starts sperren',
    'Demo-Szenario Offline → gespeicherte Vorlage öffnen.',
    'Der letzte Stand bleibt verfügbar. Parameter können angesehen und bearbeitet werden; der Start ist deaktiviert. Hier ist der Offline-Hinweis im Dialog zu sehen.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await setScenario('normal');
  await page.getByRole('button', { name: 'Neu konfigurieren' }).click();
  dialog = page.getByRole('dialog', { name: 'Workflow starten' });
  await dialog
    .getByLabel('Repository', { exact: true })
    .selectOption('demo-personal-site');
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await capture(
    'fehlende-rechte',
    'Fehlende Rechte verständlich anzeigen',
    'Neu konfigurieren → demo-dev/website-demo wählen.',
    'Der Hinweis erklärt das fehlende Schreibrecht. Der Start bleibt gesperrt; es wird keine Berechtigung angefordert.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await setScenario('uncertain');
  dialog = await openPin('Windows build');
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  dialog = await openPin('Windows build');
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Status prüfen', exact: true })
    .click();
  await expect(
    dialog.getByText(/Status geprüft. Die Startannahme bleibt ungeklärt/),
  ).toBeVisible();
  await bottom(dialog);
  await capture(
    'ungeklaert-gesperrt',
    'Ungeklärte Starts bleiben gesperrt',
    'Antwortunterbrechung simulieren → Dialog schließen → dieselbe Vorlage erneut öffnen → Status prüfen.',
    'Die Warnung bleibt beim Wiederöffnen erhalten. Ein erneuter Start ist schon vor dem Klick gesperrt; Status prüfen meldet den weiterhin ungeklärten Zustand.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await page.getByLabel('Workflows durchsuchen').fill('unmatched-query');
  await expect(
    page.getByRole('heading', {
      name: 'Keine passenden Vorlagen oder Workflows',
    }),
  ).toBeVisible();
  await capture(
    'leere-suche',
    'Auch eine erfolglose Suche hat einen nächsten Schritt',
    'In Favoriten nach unmatched-query suchen.',
    'Leere Repo-Gruppen verschwinden; Suche leeren bietet einen klaren Rückweg.',
  );
  await page.getByLabel('Workflows durchsuchen').fill('');
  await page
    .getByRole('button', { name: 'Einstellungen', exact: true })
    .click();
  await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
  await capture(
    'github-anmelden',
    'Mit GitHub anmelden',
    'Einstellungen → Einrichten.',
    'Primärer Browser-Login und nachrangiger Token-Weg. Der gesamte Anmeldeablauf ist klar als lokale Vorschau gekennzeichnet.',
  );
  dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await dialog
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await expect(
    dialog.getByRole('heading', { name: 'Im Browser bestätigen' }),
  ).toBeVisible();
  await capture(
    'browser-bestaetigung',
    'Die Bestätigung erfolgt im Browser',
    'Mit GitHub anmelden → wartender Bestätigungsschritt.',
    'RepoTray zeigt einen kurzen Beispielcode und erklärt den Browser-Schritt. Hier wird weder ein echter Browser geöffnet noch ein Konto autorisiert.',
  );
  await dialog.getByRole('button', { name: 'Bestätigung simulieren' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Demo-Anmeldung bestätigt/)).toBeVisible();
  await capture(
    'automatisch-zur-app',
    'Nach Bestätigung automatisch zurück zur App',
    'Browser-Bestätigung simulieren.',
    'Der Dialog schließt automatisch. Kopfzeile und Rückmeldung zeigen demo-dev ausdrücklich als simuliert verbunden. Die Tastatur landet wieder bei der Kontoauswahl.',
  );

  async function signInAgain() {
    await page
      .getByRole('button', { name: 'Einstellungen', exact: true })
      .click();
    await page.getByRole('button', { name: 'Einrichten', exact: true }).click();
    return page.getByRole('dialog', { name: 'GitHub verbinden' });
  }
  dialog = await signInAgain();
  await dialog
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Anmeldung abbrechen' }).click();
  await expect(
    dialog.getByRole('heading', { name: 'Anmeldung abgebrochen' }),
  ).toBeVisible();
  await capture(
    'anmeldung-abgebrochen',
    'Abbrechen beendet den Anmeldeversuch',
    'Wartenden Anmeldeschritt → Anmeldung abbrechen.',
    'Der Versuch ist beendet; verspätete Antworten können ihn nicht wieder aktivieren. Erneut versuchen bietet einen klaren nächsten Schritt.',
  );
  await dialog.getByRole('button', { name: 'Erneut versuchen' }).click();
  await dialog
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await dialog
    .getByText('Weitere Demo-Zustände ansehen', { exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Code ablaufen lassen' }).click();
  await capture(
    'code-abgelaufen',
    'Abgelaufenen Code verständlich erneuern',
    'Demo-Zustand Code ablaufen lassen.',
    'Der alte Code wird nicht weiter verwendet. Ein neuer Versuch beginnt wieder am Anmeldeeinstieg.',
  );
  await dialog.getByRole('button', { name: 'Erneut versuchen' }).click();
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await capture(
    'token-alternative',
    'Ein Token bleibt eine nachrangige Alternative',
    'Alternativ: Token hinterlegen öffnen → ausschließlich demo-token eingeben.',
    'Maskiertes Eingabefeld und Hinweis auf den Betriebssystem-Tresor. In der Demo wird der Beispielwert nur geprüft und sofort verworfen; echte Tokens werden nicht benötigt.',
  );
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(/Demo-Token geprüft und verworfen/),
  ).toBeVisible();
  dialog = await signInAgain();
  await dialog
    .getByRole('button', { name: 'Mit GitHub anmelden', exact: true })
    .click();
  await dialog
    .getByText('Weitere Demo-Zustände ansehen', { exact: true })
    .click();
  await dialog.getByRole('button', { name: 'Ablehnung simulieren' }).click();
  await capture(
    'freigabe-abgelehnt',
    'Eine abgelehnte Freigabe wird klar angezeigt',
    'Demo-Zustand Ablehnung simulieren.',
    'Der Versuch erzeugt keine neue Verbindung. Eine Wiederholung ist eine bewusste Aktion; keine Freigabe wird automatisch erneut angefordert.',
  );
  if (externalRequests.length)
    throw new Error(
      `Unexpected external network requests: ${externalRequests.length}`,
    );
  const styleSources = (await readdir(path.join(root, 'src/styles')))
    .filter((file) => file.endsWith('.css'))
    .sort()
    .map((file) => `src/styles/${file}`);
  const frontendSources = [
    'src/App.svelte',
    ...styleSources,
    'src/lib/ConnectPanel.svelte',
  ];
  const sourceFingerprints = Object.fromEntries(
    await Promise.all(
      frontendSources.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(path.join(root, file)))
          .digest('hex'),
      ]),
    ),
  );
  const appSourceSha256 = createHash('sha256')
    .update(await readFile(path.join(root, 'src/App.svelte')))
    .digest('hex');
  await writeFile(
    path.join(root, 'docs/review/manifest.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'browser-demo',
        viewport: { width: 480, height: 760 },
        deviceScaleFactor: 2,
        acceptance: 'Local demo capture',
        appSourceSha256,
        sourceFingerprints,
        externalRequests,
        steps,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Captured and verified ${steps.length} actual interaction screenshots. No external requests.`,
  );
} finally {
  await browser.close();
}
