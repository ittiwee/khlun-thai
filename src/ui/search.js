// ช่องค้นหาสถานี + สวิตช์ "เฉพาะประเทศนี้ / ทุกประเทศ" (debounce 300ms)
const DEBOUNCE_MS = 300;

export function createSearch(root, { onChange }) {
  root.innerHTML = `
    <div class="search"><input data-q type="search" enterkeyhint="search" autocomplete="off"
      placeholder="ค้นหาชื่อสถานี" aria-label="ค้นหาชื่อสถานี"></div>
    <div class="seg" role="group" aria-label="ขอบเขตการค้นหา">
      <button type="button" class="seg-b" data-scope="country" aria-pressed="true">เฉพาะประเทศนี้</button>
      <button type="button" class="seg-b" data-scope="all" aria-pressed="false">ทุกประเทศ</button>
    </div>`;
  const input = root.querySelector('[data-q]');
  const scopes = [...root.querySelectorAll('[data-scope]')];
  let scope = 'country';
  let timer = 0;

  const value = () => ({ query: input.value.trim(), scope });
  const emit = () => onChange(value());

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(emit, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(timer);
      emit();
    } else if (e.key === 'Escape' && input.value) {
      input.value = '';
      clearTimeout(timer);
      emit();
    }
  });
  for (const b of scopes) {
    b.addEventListener('click', () => {
      if (scope === b.dataset.scope) return;
      scope = b.dataset.scope;
      scopes.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      if (input.value.trim()) emit();
    });
  }

  return {
    value,
    clear() {
      clearTimeout(timer);
      input.value = '';
    },
  };
}
