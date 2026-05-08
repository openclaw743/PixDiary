terraform {
  required_version = ">= 1.6.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-${var.name_prefix}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_container_app_environment" "this" {
  name                       = "cae-${var.name_prefix}"
  resource_group_name        = var.resource_group_name
  location                   = var.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  infrastructure_subnet_id       = var.container_app_subnet_id
  internal_load_balancer_enabled = false

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }

  tags = var.tags
}

resource "azurerm_container_app" "backend" {
  name                         = "ca-${var.name_prefix}-backend"
  resource_group_name          = var.resource_group_name
  container_app_environment_id = azurerm_container_app_environment.this.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"

  identity {
    type         = "UserAssigned"
    identity_ids = [var.user_assigned_identity_id]
  }

  dynamic "registry" {
    for_each = var.acr_login_server == "" ? [] : [1]
    content {
      server   = var.acr_login_server
      identity = var.user_assigned_identity_id
    }
  }

  ingress {
    external_enabled = true
    target_port      = 3000
    transport        = "auto"
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  template {
    min_replicas = 0
    max_replicas = 3

    container {
      name   = "backend"
      image  = var.container_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = var.user_assigned_identity_client_id
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "STORAGE_CONNECTION_STRING"
        secret_name = "storage-connection-string"
      }
      env {
        name        = "MAPS_SUBSCRIPTION_KEY"
        secret_name = "maps-subscription-key"
      }
      env {
        name        = "JWT_SECRET"
        secret_name = "jwt-secret"
      }
      env {
        name  = "STORAGE_ACCOUNT_NAME"
        value = var.storage_account_name
      }
      env {
        name  = "STORAGE_CONTAINER_NAME"
        value = var.storage_container_name
      }
      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = var.openai_endpoint
      }
      env {
        name  = "AZURE_OPENAI_DEPLOYMENT_DEFAULT"
        value = var.openai_default_deployment
      }
      env {
        name  = "AZURE_OPENAI_DEPLOYMENT_HIGH"
        value = var.openai_high_deployment
      }
    }

    http_scale_rule {
      name                = "http-scale"
      concurrent_requests = "20"
    }
  }

  secret {
    name                = "database-url"
    identity            = var.user_assigned_identity_id
    key_vault_secret_id = var.kv_postgres_connection_string_id
  }

  secret {
    name                = "storage-connection-string"
    identity            = var.user_assigned_identity_id
    key_vault_secret_id = var.kv_storage_connection_string_id
  }

  secret {
    name                = "maps-subscription-key"
    identity            = var.user_assigned_identity_id
    key_vault_secret_id = var.kv_maps_subscription_key_id
  }

  secret {
    name                = "jwt-secret"
    identity            = var.user_assigned_identity_id
    key_vault_secret_id = var.kv_jwt_secret_id
  }

  tags = var.tags
}
