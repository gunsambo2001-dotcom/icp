// Комментарии наставника внутри сделки ученика — только чтение (писать может лишь
// наставник, см. mentor.js). Блок появляется, только если комментарии есть; у ученика
// без наставника и в демо-режиме его нет вовсе. Текст — только через text, не html.

import { h, mount } from './dom.js';
import * as F from './format.js';

/**
 * @param {import('../store/store-interface.js').JournalStore} store
 * @param {string} tradeId
 * @param {{id: string, displayName: string}|null} mentor — текущий наставник ученика (для подписи автора)
 * @returns {HTMLElement} контейнер, который сам заполняется после загрузки
 */
export function studentCommentsBlock(store, tradeId, mentor) {
  const box = h('div', { hidden: true });

  function show(...nodes) {
    box.hidden = false;
    mount(box, ...nodes);
  }

  async function load() {
    let comments;
    try {
      comments = await store.listTradeComments(tradeId);
    } catch {
      show(
        h('div.section-label', { style: 'margin-bottom:8px;', text: 'Комментарии наставника' }),
        h('div', { style: 'color:var(--muted);font-size:12.5px;', text: 'Не удалось загрузить комментарии.' }),
        h('button.btn', { style: 'margin-top:8px;', onclick: load }, ['Повторить']),
      );
      return;
    }
    if (!comments.length) {
      box.hidden = true;
      return;
    }
    show(
      h('div.section-label', { style: 'margin-bottom:8px;', text: 'Комментарии наставника' }),
      h('div', { style: 'display:grid;gap:8px;' }, comments.map((c) => {
        // имя знаем только у нынешнего наставника; комментарий прежнего подписываем нейтрально
        const author = mentor && c.mentorId === mentor.id ? mentor.displayName || 'Наставник' : 'Наставник';
        const edited = c.updatedAt && c.createdAt && new Date(c.updatedAt) - new Date(c.createdAt) > 1000;
        return h('div.callout', {}, [
          h('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere;', text: c.comment }),
          h('div', { style: 'font-size:11.5px;color:var(--muted);margin-top:6px;display:flex;gap:10px;align-items:center;' }, [
            h('span', { text: `${author} · ${F.dateTime(c.createdAt)}` }),
            edited ? h('span.tag', { text: 'изменён' }) : null,
          ]),
        ]);
      })),
    );
  }

  load();
  return box;
}
