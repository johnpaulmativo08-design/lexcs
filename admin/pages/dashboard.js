import { renderOperations } from '../dashboard-view.js?v=20';

export async function renderDashboard(content) {
  await renderOperations(content);
}
