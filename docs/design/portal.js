"use strict";
// 検索は入口を補助する。全ナビゲーションと本文は静的HTMLで使える。
const controls = document.querySelector("#search-controls");
const input = document.querySelector("#area-search");
const cards = [...document.querySelectorAll(".area-card")];
const count = document.querySelector("#search-count");
const empty = document.querySelector("#no-results");
if (controls && input && count && empty) {
  const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("ja");
  const filter = () => {
    const terms = normalize(input.value).trim().split(/\s+/).filter(Boolean);
    let visible = 0;
    for (const card of cards) {
      card.hidden = !terms.every((term) =>
        normalize(card.dataset.search).includes(term),
      );
      if (!card.hidden) visible++;
    }
    count.textContent = `${cards.length}領域中 ${visible}領域を表示`;
    empty.hidden = visible > 0;
  };
  input.addEventListener("input", filter);
  controls.hidden = false;
  filter();
}
