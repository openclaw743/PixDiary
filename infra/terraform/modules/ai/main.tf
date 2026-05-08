terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

# Azure AI Foundry uses the AIServices kind on Cognitive Services accounts.
# This account hosts the OpenAI deployments used for vision + chat.
resource "azurerm_cognitive_account" "foundry" {
  name                  = "aif-${var.name_prefix}"
  location              = var.location
  resource_group_name   = var.resource_group_name
  kind                  = "AIServices"
  sku_name              = "S0"
  custom_subdomain_name = "aif-${var.name_prefix}"

  public_network_access_enabled = true
  local_auth_enabled            = false # MI-only; backend uses managed identity

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# Default chat + vision model — gpt-4o-mini (low cost, multimodal)
resource "azurerm_cognitive_deployment" "gpt_4o_mini" {
  name                 = "gpt-4o-mini"
  cognitive_account_id = azurerm_cognitive_account.foundry.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o-mini"
    version = "2024-07-18"
  }

  sku {
    name     = "GlobalStandard"
    capacity = var.gpt_4o_mini_capacity
  }
}

# Reserved escalation model for "regenerate with better quality"
resource "azurerm_cognitive_deployment" "gpt_4o" {
  name                 = "gpt-4o"
  cognitive_account_id = azurerm_cognitive_account.foundry.id

  model {
    format  = "OpenAI"
    name    = "gpt-4o"
    version = "2024-08-06"
  }

  sku {
    name     = "GlobalStandard"
    capacity = var.gpt_4o_capacity
  }
}
