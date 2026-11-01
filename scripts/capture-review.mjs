/*
 * End-to-end review walk through the browser demo in both themes: overview,
 * Verlauf, account switch, failure details, favorites and the start dialog,
 * the picker, offline / missing rights / uncertain starts, an empty search,
 * the theme setting and the GitHub connection preview with the demo token.
 * Each step asserts its outcome before the screenshot;
 * docs/review/manifest.json records every step.
 */
import { expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  THEMES,
  assertLocalOnly,
  chooseAccount,
  fileSha256,
  launch,
  openDemo,
  openFavorite,
  openPage,
  openSettings,
  root,
  scenario,
  scrollToEnd,
  sha256,
  sourceFingerprints,
} from './capture-support.mjs';

const output = path.join(root, 'docs/review/screenshots');
await mkdir(output, { recursive: true });
const browser = await launch();
/**
 * @type {{
 *   filename: string;
 *   theme: string;
 *   title: string;
 *   interaction: string;
 *   expected: string;
 *   sha256: string;
 * }[]}
 */
const steps = [];
/** @type {string[]} */
const externalRequests = [];

/**
 * One walk through the demo in a fresh context with the OS preferring `theme`.
 * @param {import('./capture-support.mjs').Theme} theme
 */
async function walk(theme) {
  const demo = await openDemo(browser, { theme });
  const { page } = demo;
  let index = 0;
  /**
   * @param {string} name
   * @param {string} title
   * @param {string} interaction
   * @param {string} expected
   */
  async function capture(name, title, interaction, expected) {
    index += 1;
    const filename = `${String(index).padStart(2, '0')}-${name}-${theme}.png`;
    await page.screenshot({
      path: path.join(output, filename),
      animations: 'disabled',
    });
    steps.push({
      filename,
      theme,
      title,
      interaction,
      expected,
      sha256: await fileSha256(path.join(output, filename)),
    });
  }
  const startDialog = page.getByRole('dialog', { name: 'Workflow starten' });

  await capture(
    'uebersicht',
    'Alles Wichtige auf einen Blick',
    'App öffnen.',
    'Läuft gerade, Favoriten und Repositories mit Run-Streifen. Ausschließlich Beispieldaten.',
  );

  await openPage(page, 'runs');
  await capture(
    'verlauf',
    'Alle Repositories im Verlauf',
    '„Läuft gerade“ maximieren.',
    'Run-Verlauf mit vollem Owner, Workflow-Status und Branch; Filter Alle.',
  );

  await chooseAccount(page, 'team-demo');
  await expect(
    page.getByText('example-org/runner-tools-demo', { exact: true }).first(),
  ).toBeVisible();
  await capture(
    'konto-wechsel',
    'Arbeitskonto gezielt ansehen',
    'Kontomenü → team-demo.',
    'Es erscheinen nur die Repositories dieses Demo-Kontos; Owner example-org bleibt erkennbar.',
  );

  await chooseAccount(page, 'demo-dev');
  await page.getByRole('button', { name: /^Fehlgeschlagen/ }).click();
  await page
    .getByRole('button', {
      name: /^Preview site #\d+ · demo-dev\/website-demo/,
    })
    .click();
  await capture(
    'fehlerdetails',
    'Einen fehlgeschlagenen Run untersuchen',
    'Kontomenü → demo-dev → Filter Fehlgeschlagen → Preview site aufklappen.',
    'Ergebnis und Konto sind sichtbar. Ein echter GitHub-Link wird für simulierte Runs nicht vorgetäuscht.',
  );

  await openPage(page, 'favorites');
  await capture(
    'favoriten',
    'Häufige Starts als Favoriten',
    'Zurück → „Favoriten“ maximieren.',
    'Windows build ist gespeichert. Starten… führt zur Bestätigung; Schnellstart ist standardmäßig aus.',
  );

  let dialog = await openFavorite(page, 'Windows build');
  await dialog.getByLabel('Branch oder Tag').selectOption('develop');
  await dialog.getByLabel('Build target').selectOption('linux-x64');
  await dialog.getByLabel('Version', { exact: true }).fill('0.2.0');
  await capture(
    'start-konfigurieren',
    'Branch und Parameter einstellen',
    'Favorit starten… → develop → linux-x64 → Version 0.2.0.',
    'Repository und Workflow bleiben eindeutig; Dry run bleibt eingeschaltet. Noch wurde nichts gestartet.',
  );

  await dialog.getByText('Als Favorit speichern', { exact: true }).click();
  await dialog.getByLabel('Name des Favoriten').fill('Linux develop');
  await dialog
    .getByRole('button', { name: 'Als neuen Favoriten speichern' })
    .click();
  await expect(
    dialog.getByText('„Linux develop“ als Favorit gespeichert.', {
      exact: true,
    }),
  ).toBeVisible();
  await scrollToEnd(dialog);
  await capture(
    'favorit-speichern',
    'Eine Variante als neuen Favoriten speichern',
    'Als Favorit speichern → Linux develop → Als neuen Favoriten speichern.',
    'Die Variante wird lokal gespeichert; Windows build bleibt erhalten. Schnellstart bleibt aus, nichts wird gestartet.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await capture(
    'favorit-gespeichert',
    'Gespeicherte Auswahl wiederverwenden',
    'Dialog schließen.',
    'Linux develop erscheint mit dem gespeicherten Ref develop und Starten….',
  );

  dialog = await openFavorite(page, 'Linux develop');
  await expect(dialog.getByLabel('Version', { exact: true })).toHaveValue(
    '0.2.0',
  );
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Simulierter Start angenommen', { exact: true }),
  ).toBeVisible();
  await scrollToEnd(dialog);
  await capture(
    'start-angenommen',
    'Startannahme mit konkreter Run-ID',
    'Gespeicherten Favoriten starten… → Start simulieren.',
    'Genau Demo-Run #9001 wird angenommen; Annahme und Build-Erfolg werden getrennt.',
  );
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();

  await openPage(page, 'runs');
  await page
    .getByRole('button', { name: 'Abgeschlossen', exact: true })
    .click();
  const newRun = page
    .locator('article.run')
    .filter({ has: page.getByText('#9001', { exact: true }) });
  await expect(newRun.locator('.run-button')).toHaveAccessibleName(
    /Erfolgreich/,
    { timeout: 6000 },
  );
  await newRun.locator('.run-button').click();
  await capture(
    'run-verfolgen',
    'Diesen Run im Verlauf verfolgen',
    'Nach Abschluss Verlauf → Abgeschlossen → #9001 aufklappen.',
    'Der neue Demo-Run zeigt develop, den erreichten Zustand und das Konto. Weiterhin lokale Simulation.',
  );

  await openPage(page, 'picker');
  await capture(
    'repo-auswahl',
    'Repositories im Panel hinzufügen und entfernen',
    'Zurück → Repositories „+ Hinzufügen“.',
    'Nach Konto gruppiert; voller Owner/Repo und Lese- beziehungsweise Schreibrecht. Änderungen gelten sofort.',
  );

  await scenario(page, 'offline');
  dialog = await openFavorite(page, 'Windows build');
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await scrollToEnd(dialog);
  await capture(
    'offline',
    'Favoriten offline öffnen, Starts sperren',
    'Demo-Szenario Offline → Favorit starten….',
    'Der letzte Stand bleibt verfügbar; Parameter lassen sich ansehen, der Start ist deaktiviert.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await scenario(page, 'normal');
  await page
    .getByRole('button', { name: 'Workflow starten …', exact: true })
    .click();
  await startDialog
    .getByLabel('Repository', { exact: true })
    .selectOption('demo-personal-site');
  await expect(
    startDialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await capture(
    'fehlende-rechte',
    'Fehlende Rechte verständlich anzeigen',
    'Workflow starten … → demo-dev/website-demo wählen.',
    'Der Hinweis erklärt das fehlende Schreibrecht. Der Start bleibt gesperrt; keine Berechtigung wird angefordert.',
  );
  await startDialog
    .getByRole('button', { name: 'Abbrechen', exact: true })
    .click();

  await scenario(page, 'uncertain');
  dialog = await openFavorite(page, 'Windows build');
  await dialog.getByRole('button', { name: 'Start simulieren' }).click();
  await expect(
    dialog.getByText('Startstatus ungeklärt', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).click();
  dialog = await openFavorite(page, 'Windows build');
  await expect(
    dialog.getByRole('button', { name: 'Start simulieren' }),
  ).toBeDisabled();
  await dialog
    .getByRole('button', { name: 'Status prüfen', exact: true })
    .click();
  await expect(dialog.getByText(/^Status geprüft\./)).toBeVisible();
  await scrollToEnd(dialog);
  await capture(
    'ungeklaert-gesperrt',
    'Ungeklärte Starts bleiben gesperrt',
    'Antwortunterbrechung simulieren → schließen → erneut starten… → Status prüfen.',
    'Die Warnung bleibt beim Wiederöffnen; ein erneuter Start ist gesperrt, Status prüfen meldet den weiter ungeklärten Zustand.',
  );
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();

  await openPage(page, 'overview');
  await page.locator('.search-field input').fill('unmatched-query');
  await expect(
    page.getByRole('heading', { name: 'Keine Treffer', exact: true }),
  ).toBeVisible();
  await capture(
    'leere-suche',
    'Auch eine erfolglose Suche hat einen nächsten Schritt',
    'In der Übersicht nach unmatched-query suchen.',
    'Ein gemeinsamer Leerzustand statt drei leerer Sektionen; „Suche leeren“ führt zurück.',
  );
  await page
    .getByRole('button', { name: 'Suche leeren', exact: true })
    .first()
    .click();

  const settings = await openSettings(page, 'App');
  await expect(
    settings.getByRole('radio', { name: 'System', exact: true }),
  ).toBeChecked();
  await capture(
    'darstellung',
    'Hell, dunkel oder wie das System',
    'Einstellungen → App.',
    '„Darstellung“ mit System, Hell und Dunkel; System folgt dem Betriebssystem.',
  );

  await settings.getByRole('tab', { name: 'Konten', exact: true }).click();
  await settings
    .getByRole('button', { name: 'Konto hinzufügen', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'GitHub verbinden' });
  await expect(
    dialog.getByRole('button', { name: /Mit GitHub anmelden/ }),
  ).toBeDisabled();
  await capture(
    'github-verbinden',
    'GitHub verbinden',
    'Einstellungen → Konto hinzufügen.',
    'Die Browser-Anmeldung ist sichtbar pausiert; der Token-Weg bleibt. Alles ist als lokale Vorschau gekennzeichnet.',
  );
  await dialog
    .getByText('Alternativ: Token hinterlegen', { exact: true })
    .click();
  await dialog.getByLabel('Beispiel-Token').fill('demo-token');
  await capture(
    'token-alternative',
    'Ein Token als Alternative',
    'Alternativ: Token hinterlegen → ausschließlich demo-token eingeben.',
    'Maskiertes Eingabefeld und Hinweis auf den Betriebssystem-Tresor; der Beispielwert wird nur geprüft und verworfen.',
  );
  await dialog
    .getByRole('button', { name: 'Token prüfen und verbinden' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(/Demo-Token geprüft und verworfen/),
  ).toBeVisible();
  await capture(
    'token-verworfen',
    'Der Beispiel-Token wird nicht gespeichert',
    'Token prüfen und verbinden.',
    'Der Dialog schließt; die Meldung bestätigt, dass der Beispielwert geprüft und verworfen wurde.',
  );

  externalRequests.push(...demo.externalRequests);
  await demo.context.close();
}

try {
  for (const theme of THEMES) await walk(theme);
  assertLocalOnly(externalRequests);
  await writeFile(
    path.join(root, 'docs/review/manifest.json'),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        mode: 'browser-demo',
        viewport: { width: 480, height: 760 },
        deviceScaleFactor: 2,
        themes: THEMES,
        acceptance: 'Local demo capture',
        appSourceSha256: sha256(
          await readFile(path.join(root, 'src/App.svelte')),
        ),
        sourceFingerprints: await sourceFingerprints(),
        externalRequests,
        steps,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Captured and verified ${steps.length} interaction screenshots in both themes. No external requests.`,
  );
} finally {
  await browser.close();
}
