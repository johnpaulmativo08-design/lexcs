import { renderOperations } from '../dashboard-view.js?v=6';

export async function renderDashboard(content) {
  await renderOperations(content);
}
