import { renderOperations } from '../dashboard-view.js?v=16';

export async function renderDashboard(content) {
  await renderOperations(content);
}
