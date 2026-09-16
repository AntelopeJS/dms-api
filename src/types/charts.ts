export interface ChartDataPoint {
  x: string;
  y: number;
  label?: string;
  category?: string;
}

export interface ChartResponse {
  data?: ChartDataPoint[];
}
