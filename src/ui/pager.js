// ตัวแบ่งหน้า: ‹ ก่อนหน้า · 1 … 4 5 [6] 7 8 … 120 · ถัดไป › + ช่องพิมพ์เลขหน้า

// เลขหน้าที่จะแสดง — คืน array ของตัวเลขและ '…'
// ถ้า total เป็น null (ไม่รู้จำนวนรวม เช่นกรอง tag) แสดงแค่หน้าที่ผ่านมาจนถึงหน้าปัจจุบันแบบย่อ
export function pageItems(current, total, { around = 2 } = {}) {
  const last = total ?? current;
  if (last <= 1) return [1];
  const set = new Set([1, last]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= last) set.add(p);
  const pages = [...set].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    if (i && pages[i] - pages[i - 1] === 2) out.push(pages[i] - 1); // ช่องว่างหน้าเดียว แสดงเลขแทน …
    else if (i && pages[i] - pages[i - 1] > 2) out.push('…');
    out.push(pages[i]);
  }
  return out;
}

export function createPager(root, { onPage }) {
  let page = 1;
  let total = 1;
  let hasNext = false;

  function btn(label, target, { aria, current = false, disabled = false } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pg';
    b.textContent = label;
    if (aria) b.setAttribute('aria-label', aria);
    if (current) b.setAttribute('aria-current', 'page');
    b.disabled = disabled;
    b.addEventListener('click', () => onPage(target));
    return b;
  }

  function render() {
    const last = total ?? (hasNext ? page + 1 : page);
    if (last <= 1 && !hasNext) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const nodes = [btn('‹ ก่อนหน้า', page - 1, { aria: 'หน้าก่อนหน้า', disabled: page <= 1 })];
    for (const it of pageItems(page, total)) {
      if (it === '…') {
        const s = document.createElement('span');
        s.className = 'pg-gap';
        s.textContent = '…';
        s.setAttribute('aria-hidden', 'true');
        nodes.push(s);
      } else {
        nodes.push(btn(String(it), it, { aria: `หน้า ${it}`, current: it === page }));
      }
    }
    nodes.push(btn('ถัดไป ›', page + 1, { aria: 'หน้าถัดไป', disabled: total != null ? page >= total : !hasNext }));

    if (total != null && total > 1) {
      const label = document.createElement('label');
      label.className = 'pg-go';
      const input = document.createElement('input');
      input.type = 'number';
      input.inputMode = 'numeric';
      input.min = '1';
      input.max = String(total);
      input.placeholder = String(page);
      input.setAttribute('aria-label', `ไปหน้า (1–${total})`);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const n = Math.round(Number(input.value));
        if (n >= 1 && n <= total && n !== page) onPage(n);
        else input.value = '';
      });
      label.append('ไปหน้า', input, `/ ${total}`);
      nodes.push(label);
    }
    root.replaceChildren(...nodes);
  }

  // total = จำนวนหน้าทั้งหมด หรือ null ถ้าไม่รู้ (ใช้ hasNext แทน)
  function set(next) {
    ({ page, total = null, hasNext = false } = next);
    render();
  }

  return { set };
}
