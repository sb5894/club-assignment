import type { Club } from './allocation';

export type StudentLanguage = 'ko' | 'ru';

// Summarized from the school's 2026 second-semester club presentation.
// Keep this student-only copy separate from allocation and teacher settings.
export const studentClubs: Record<
  string,
  { name: string; ko: string; ru: string; slides: number[] }
> = {
  badminton: {
    name: 'Бадминтон',
    ko: '배드민턴 치는 방법을 배우고 친구들과 연습하고 경기를 해요.',
    ru: 'Учимся играть в бадминтон, тренируемся и играем матчи с друзьями.',
    slides: [4, 5, 6, 7],
  },
  dance: {
    name: 'Танцы под любимые песни',
    ko: '좋아하는 노래에 맞춰 친구들과 춤을 배우고 함께 연습해요.',
    ru: 'Учимся танцевать под любимые песни и тренируемся вместе с друзьями.',
    slides: [9, 10],
  },
  paper: {
    name: 'Мультфильмы из бумаги',
    ko: '종이에 그린 캐릭터를 사진으로 찍고 이어 붙여 움직이는 영상을 만들어요.',
    ru: 'Рисуем героев на бумаге, фотографируем их и собираем снимки в мультфильм.',
    slides: [11, 12],
  },
  pen: {
    name: 'Рисуем ручками и пастелью',
    ko: '펜과 오일파스텔 같은 여러 가지 재료로 자유롭게 그림을 그려요.',
    ru: 'Свободно рисуем разными материалами, например ручками и масляной пастелью.',
    slides: [13],
  },
  drawing: {
    name: 'Рисуем на планшете',
    ko: '태블릿과 전용 펜으로 상상한 그림을 그리고 색칠해요.',
    ru: 'Рисуем то, что представляем, и раскрашиваем на планшете специальным пером.',
    slides: [17],
  },
  maker: {
    name: 'Игры и фигурки с ИИ',
    ko: '인공지능(AI)으로 나만의 게임을 만들고 3D 프린터로 캐릭터 모형도 만들어요.',
    ru: 'С помощью ИИ создаём свои игры, а на 3D-принтере делаем фигурки героев.',
    slides: [14],
  },
  writing: {
    name: 'Своя книга с ИИ',
    ko: '인공지능(AI)의 도움으로 이야기를 쓰고 그림을 넣어 나만의 책을 만들어요.',
    ru: 'С помощью ИИ пишем истории, добавляем картинки и делаем свою книгу.',
    slides: [20, 21],
  },
  media: {
    name: 'Снимаем видео',
    ko: '가짜 뉴스를 알아보는 법을 배우고 우리 동네 이야기를 영상으로 찍고 편집해요.',
    ru: 'Учимся отличать ложные новости от правдивых, снимаем и собираем видео о нашем районе.',
    slides: [18, 19],
  },
  dodgeball: {
    name: 'Вышибалы',
    ko: '공을 던지고 받는 연습을 하고 친구들과 여러 가지 피구 게임을 해요.',
    ru: 'Учимся бросать и ловить мяч и играем с друзьями в разные виды вышибал.',
    slides: [15, 16],
  },
  teeball: {
    name: 'Тибол',
    ko: '받침대 위에 놓인 공을 배트로 치고 달리며 친구들과 티볼 경기를 해요.',
    ru: 'Бьём битой по мячу на подставке, бегаем и играем с друзьями в тибол.',
    slides: [22, 23],
  },
  language: {
    name: 'Два языка',
    ko: '여러 나라의 문화를 알아보고 전통 놀이와 만들기, 퀴즈를 즐겨요.',
    ru: 'Узнаём о культуре разных стран через народные игры, поделки и викторины.',
    slides: [24],
  },
  counsel: {
    name: 'Поддержка друзей',
    ko: '친구의 고민을 듣고 도와주는 방법을 배우고 또래상담을 연습해요.',
    ru: 'Учимся слушать, что волнует друзей, и пробуем помогать им в беседе.',
    slides: [25],
  },
};

export function studentClubName(
  club: Pick<Club, 'id' | 'name'>,
  language: StudentLanguage,
) {
  const translated = studentClubs[club.id];
  return language === 'ru' && translated
    ? `${translated.name} (${club.name})`
    : club.name;
}

export function studentClubDescription(id: string, language: StudentLanguage) {
  return (
    studentClubs[id]?.[language] ??
    (language === 'ru'
      ? 'Спроси учителя, чем занимается этот кружок.'
      : '어떤 활동을 하는 동아리인지 선생님에게 물어보세요.')
  );
}
