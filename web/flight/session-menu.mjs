// SPDX-License-Identifier: GPL-3.0-only
const CHECKPOINT_INTERVAL_MS = 2000;

function downloadJournal(serialized) {
 const url = URL.createObjectURL(new Blob([serialized], {type:'application/json'}));
 const link = document.createElement('a');
 link.href = url;
 link.download = 'into-the-night-mission-journal.json';
 link.click();
 setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Browser storage and file controls; MissionSession remains the save-format authority. */
export function bindSessionMenu(controller, {onRestore, onRestart}) {
 const SAVE_KEY=controller.session.definition.chapterOne?'into-the-night-campaign-v1':'into-the-night-flight-v3';
 const menu = document.getElementById('session-menu');
 const message = document.getElementById('session-message');
 const restoreButton = document.getElementById('restore-mission');
 const fileInput = document.getElementById('import-mission');
 const listeners = new AbortController();
 const listen = (element, event, handler) => element.addEventListener(event, handler, {signal:listeners.signal});
 let lastCheckpoint = -Infinity;
 let automaticSaveAllowed = true;

 function report(text) {
  message.textContent = text;
 }

 function persist(manual = false) {
  if (!manual && !automaticSaveAllowed) return false;
  lastCheckpoint = performance.now();
  try {
   localStorage.setItem(SAVE_KEY, controller.session.save());
   automaticSaveAllowed = true;
   restoreButton.disabled = false;
   if (manual) report('Партия сохранена в этом браузере.');
   return true;
  } catch {
   report('Не удалось сохранить партию в браузере. Экспортируйте журнал в файл.');
   return false;
  }
 }

 function restore(serialized) {
  controller.restore(serialized);
  onRestore();
  automaticSaveAllowed = true;
  const saved = persist();
  if (saved) report('Партия восстановлена на паузе.');
 }

 // Keep a damaged stored file until the player explicitly saves or starts again.
 try {
  const saved = localStorage.getItem(SAVE_KEY);
  restoreButton.disabled = !saved;
  if (saved) {
   controller.restore(saved);
   report('Партия восстановлена на паузе.');
  }
 } catch {
  automaticSaveAllowed = false;
  report('Не удалось восстановить сохранённую партию. Сохранение не перезаписано.');
 }

 listen(document.getElementById('save-mission'), 'click', () => persist(true));
 listen(restoreButton, 'click', () => {
  try {
   const saved = localStorage.getItem(SAVE_KEY);
   if (!saved) throw Error('No saved party');
   restore(saved);
  } catch {
   report('Не удалось восстановить партию. Текущая игра не изменена.');
  }
 });
 listen(document.getElementById('export-mission'), 'click', () => {
  downloadJournal(controller.session.save());
  report('Журнал экспортирован в файл.');
 });
 listen(document.getElementById('import-mission-button'), 'click', () => fileInput.click());
 listen(fileInput, 'change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
   if (file.size > 16 * 1024 * 1024) throw Error('Save exceeds supported size');
   restore(await file.text());
  } catch {
   report('Не удалось загрузить файл: сохранение повреждено или несовместимо. Текущая игра не изменена.');
  } finally {
   fileInput.value = '';
  }
 });
 listen(document.getElementById('new-mission'), 'click', () => {
  if (window.confirm('Начать новую партию? Текущий прогресс будет заменён.')) {
   onRestart();
   menu.open = false;
  }
 });
 listen(document, 'keydown', event => {
  if (event.key === 'Escape' && menu.open) {
   menu.open = false;
   menu.querySelector('summary').focus();
  }
 });
 listen(document, 'pointerdown', event => {
  if (!menu.contains(event.target)) menu.open = false;
 });
 listen(window, 'pagehide', () => persist());
 listen(document, 'visibilitychange', () => {
  if (document.visibilityState === 'hidden') persist();
 });

 return {
  checkpoint(now = performance.now(), force = false) {
   if (force || now - lastCheckpoint >= CHECKPOINT_INTERVAL_MS) persist();
  },
  restart() {
   automaticSaveAllowed = true;
   if (persist()) report('Новая партия сохранена.');
  },
  destroy() {
   listeners.abort();
  },
 };
}
