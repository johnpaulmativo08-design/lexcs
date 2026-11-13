import { renderOperations } from '../dashboard-view.js?v=21';

export async function renderDashboard(content) {
  await renderOperations(content);
}
