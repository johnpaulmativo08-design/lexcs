import { renderOperations } from '../dashboard-view.js?v=19';

export async function renderDashboard(content) {
  await renderOperations(content);
}
