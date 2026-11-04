export type BankEntry = { word: string; cat: string };

export const BANK: BankEntry[] = [
  { word: "MACACO", cat: "Animais" },
  { word: "GIRAFA", cat: "Animais" },
  { word: "CACHORRO", cat: "Animais" },
  { word: "TARTARUGA", cat: "Animais" },
  { word: "BORBOLETA", cat: "Animais" },
  { word: "GOLFINHO", cat: "Animais" },
  { word: "ELEFANTE", cat: "Animais" },
  { word: "PANTERA", cat: "Animais" },
  { word: "TECLADO", cat: "Tecnologia" },
  { word: "INTERNET", cat: "Tecnologia" },
  { word: "PROGRAMA", cat: "Tecnologia" },
  { word: "JAVASCRIPT", cat: "Tecnologia" },
  { word: "COMPUTADOR", cat: "Tecnologia" },
  { word: "ALGORITMO", cat: "Tecnologia" },
  { word: "CELULAR", cat: "Tecnologia" },
  { word: "SENHA", cat: "Tecnologia" },
  { word: "MONTANHA", cat: "Natureza" },
  { word: "CACHOEIRA", cat: "Natureza" },
  { word: "FLORESTA", cat: "Natureza" },
  { word: "TEMPESTADE", cat: "Natureza" },
  { word: "PLANETA", cat: "Natureza" },
  { word: "ESTRELA", cat: "Natureza" },
  { word: "OCEANO", cat: "Natureza" },
  { word: "DESERTO", cat: "Natureza" },
  { word: "MOCHILA", cat: "Objetos" },
  { word: "TESOURA", cat: "Objetos" },
  { word: "RELÓGIO", cat: "Objetos" },
  { word: "JANELA", cat: "Objetos" },
  { word: "GARRAFA", cat: "Objetos" },
  { word: "TRAVESSEIRO", cat: "Objetos" },
  { word: "CADERNO", cat: "Objetos" },
  { word: "ABACAXI", cat: "Comidas" },
  { word: "CHOCOLATE", cat: "Comidas" },
  { word: "LASANHA", cat: "Comidas" },
  { word: "MORANGO", cat: "Comidas" },
  { word: "PIPOCA", cat: "Comidas" },
  { word: "FEIJOADA", cat: "Comidas" },
  { word: "MELANCIA", cat: "Comidas" },
  { word: "BRASIL", cat: "Brasil" },
  { word: "AMAZONIA", cat: "Brasil" },
  { word: "CAPOEIRA", cat: "Brasil" },
  { word: "CARNAVAL", cat: "Brasil" },
  { word: "PANTANAL", cat: "Brasil" },
  { word: "SAMBA", cat: "Brasil" },
  { word: "VITORIA", cat: "Brasil" },
  { word: "FUTEBOL", cat: "Brasil" },
];

export const CATEGORIES = ["Todas", ...new Set(BANK.map((entry) => entry.cat))];

export function pickWord(category: string, avoid = ""): BankEntry {
  const list = BANK.filter((entry) => category === "Todas" || entry.cat === category);
  const choices = list.filter((entry) => entry.word !== avoid);
  const pool = choices.length ? choices : list;
  return pool[Math.floor(Math.random() * pool.length)] ?? BANK[0]!;
}
