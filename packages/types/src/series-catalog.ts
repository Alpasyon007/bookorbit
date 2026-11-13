export interface SeriesCatalogSeries {
  id: number;
  name: string;
  author: string | null;
}

export interface SeriesCatalogBook {
  id: string;
  title: string;
  authors: string[];
  position: number | null;
  releaseDate: string | null;
}

export interface SeriesCatalogPage<T> {
  items: T[];
  nextOffset: number | null;
}
