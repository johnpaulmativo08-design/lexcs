import { renderOperations } from '../dashboard-view.js?v=8';

export async function renderDashboard(content) {
  await renderOperations(content);
}
