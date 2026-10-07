// chips แนวเพลง (tag ยอดนิยม) — แสดงชื่อไทยถ้ามี
const TH = {
  pop: 'ป๊อป', rock: 'ร็อก', news: 'ข่าว', hits: 'เพลงฮิต', classical: 'คลาสสิก', dance: 'แดนซ์', talk: 'พูดคุย',
  oldies: 'เพลงเก่า', 'pop music': 'เพลงป๊อป', jazz: 'แจ๊ส', electronic: 'อิเล็กทรอนิก', 'top 40': 'ท็อป 40',
  'pop rock': 'ป๊อปร็อก', christian: 'คริสเตียน', 'classic rock': 'คลาสสิกร็อก', 'classic hits': 'ฮิตคลาสสิก',
  'adult contemporary': 'สากลร่วมสมัย', 'música pop': 'ป๊อปละติน', country: 'คันทรี', house: 'เฮาส์',
  'hip hop': 'ฮิปฮอป', hiphop: 'ฮิปฮอป', chillout: 'ชิลเอาต์', lounge: 'เลานจ์', blues: 'บลูส์', reggae: 'เร้กเก้',
  metal: 'เมทัล', folk: 'โฟล์ก', sports: 'กีฬา', religion: 'ศาสนา', culture: 'วัฒนธรรม', education: 'การศึกษา',
  ambient: 'แอมเบียนต์', soul: 'โซล', 'r&b': 'อาร์แอนด์บี', rnb: 'อาร์แอนด์บี', latin: 'ละติน', thai: 'เพลงไทย',
  'k-pop': 'เคป๊อป', kpop: 'เคป๊อป', 'j-pop': 'เจป๊อป', jpop: 'เจป๊อป', anime: 'อนิเมะ', indie: 'อินดี้',
  alternative: 'อัลเทอร์เนทีฟ', 'easy listening': 'ฟังสบาย', 'love songs': 'เพลงรัก', techno: 'เทคโน',
  trance: 'ทรานซ์', funk: 'ฟังก์', disco: 'ดิสโก้', gospel: 'กอสเปล', islamic: 'อิสลาม', quran: 'อัลกุรอาน',
  buddhism: 'พุทธ', kids: 'เด็ก', children: 'เด็ก', comedy: 'ตลก', soundtrack: 'เพลงประกอบ', instrumental: 'บรรเลง',
};

export function tagLabel(tag) {
  if (TH[tag]) return TH[tag];
  const era = /^(\d0)s$/.exec(tag);
  if (era) return `ยุค ${era[1]}`;
  return tag;
}

export function createTagChips(root, { onSelect }) {
  let tags = [];
  let selected = '';

  function chip(tag, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    if (tag && label !== tag) b.title = tag;
    b.setAttribute('aria-pressed', String(tag === selected));
    b.addEventListener('click', () => onSelect(tag === selected ? '' : tag));
    return b;
  }

  function render() {
    root.hidden = !tags.length;
    root.replaceChildren(chip('', 'ทั้งหมด'), ...tags.map((t) => chip(t, tagLabel(t))));
  }

  return {
    setTags(next) {
      tags = next;
      render();
    },
    setSelected(tag) {
      selected = tag;
      root.querySelectorAll('.chip').forEach((b, i) => b.setAttribute('aria-pressed', String((i ? tags[i - 1] : '') === tag)));
    },
  };
}
