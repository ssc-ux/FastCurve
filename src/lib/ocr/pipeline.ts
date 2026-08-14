// Squelette temporaire — remplacé par la chaîne complète.
export interface CelluleLue { texte: string; douteux: boolean; }
export interface LigneLue { nom: string; unite: string; cellules: CelluleLue[]; }
export interface DateLue { iso: string | null; brut: string; douteux: boolean; }
export interface TableauLu { dates: DateLue[]; lignes: LigneLue[]; }
export async function reconnaitreTableau(_img: HTMLImageElement): Promise<TableauLu> {
  return { dates: [], lignes: [] };
}
