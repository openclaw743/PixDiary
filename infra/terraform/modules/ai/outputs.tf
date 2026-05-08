output "foundry_id" {
  value = azurerm_cognitive_account.foundry.id
}

output "foundry_name" {
  value = azurerm_cognitive_account.foundry.name
}

output "foundry_endpoint" {
  value = azurerm_cognitive_account.foundry.endpoint
}

output "foundry_principal_id" {
  value = azurerm_cognitive_account.foundry.identity[0].principal_id
}

output "gpt_4o_mini_deployment_name" {
  value = azurerm_cognitive_deployment.gpt_4o_mini.name
}

output "gpt_4o_deployment_name" {
  value = azurerm_cognitive_deployment.gpt_4o.name
}
