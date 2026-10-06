import { renderOperations } from '../dashboard-view.js?v=10';

export async function renderDashboard(content) {
  await renderOperations(content);
}
