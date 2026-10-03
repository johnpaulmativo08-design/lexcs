import { renderOperations } from '../dashboard-view.js?v=9';

export async function renderDashboard(content) {
  await renderOperations(content);
}
