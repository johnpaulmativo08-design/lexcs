import { renderOperations } from '../dashboard-view.js?v=7';

export async function renderDashboard(content) {
  await renderOperations(content);
}
