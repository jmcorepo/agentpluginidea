import {readFileSync} from 'node:fs';

export const FOOD_WIDGET_URI='ui://switchboard/food-comparison/v1.html';
// A single self-contained resource, shared by the MCP iframe and browser QA.
export const foodWidgetHtml=readFileSync(new URL('../public/widgets/food-comparison.html',import.meta.url),'utf8');
