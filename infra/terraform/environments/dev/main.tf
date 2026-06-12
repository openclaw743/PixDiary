data "azurerm_resource_group" "this" {
  name = var.resource_group_name
}

# Pre-created so KV role assignment + secrets exist before the Container App
# tries to mount them via key_vault_secret_id (avoids chicken-and-egg).
resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name_prefix}-app"
  resource_group_name = data.azurerm_resource_group.this.name
  location            = var.region
  tags                = var.tags
}

# JWT secret is provisioned by Terraform (not committed) and stored in Key Vault.
resource "random_password" "jwt" {
  length           = 64
  special          = true
  override_special = "_-+=()[]{}!?"
}

module "network" {
  source              = "../../modules/network"
  name_prefix         = var.name_prefix
  location            = var.region
  resource_group_name = data.azurerm_resource_group.this.name
  tags                = var.tags
}

module "database" {
  source                       = "../../modules/database"
  name_prefix                  = var.name_prefix
  location                     = var.region
  resource_group_name          = data.azurerm_resource_group.this.name
  postgres_subnet_id           = module.network.postgres_subnet_id
  postgres_private_dns_zone_id = module.network.postgres_private_dns_zone_id
  tags                         = var.tags
}

module "ai" {
  source              = "../../modules/ai"
  name_prefix         = var.name_prefix
  location            = var.region
  resource_group_name = data.azurerm_resource_group.this.name
  tags                = var.tags
}

module "maps" {
  source              = "../../modules/maps"
  name_prefix         = var.name_prefix
  resource_group_name = data.azurerm_resource_group.this.name
  location            = var.region
  tags                = var.tags
}

module "swa" {
  source              = "../../modules/swa"
  name_prefix         = var.name_prefix
  location            = var.region
  resource_group_name = data.azurerm_resource_group.this.name
  tags                = var.tags
}

module "acr" {
  source                     = "../../modules/acr"
  name_prefix                = var.name_prefix
  location                   = var.region
  resource_group_name        = data.azurerm_resource_group.this.name
  container_app_principal_id = azurerm_user_assigned_identity.app.principal_id
  deploy_principal_id        = var.deploy_principal_id
  tags                       = var.tags
}


module "storage" {
  source               = "../../modules/storage"
  name_prefix          = var.name_prefix
  location             = var.region
  resource_group_name  = data.azurerm_resource_group.this.name
  storage_account_name = var.storage_account_name
  # Lock CORS to the SWA hostname + local dev only — no other origins.
  allowed_cors_origins = [
    "https://${module.swa.default_host_name}",
    var.swa_dev_origin,
  ]
  allowed_subnet_ids = [module.network.container_app_subnet_id]
  tags               = var.tags
}

module "keyvault" {
  source                     = "../../modules/keyvault"
  name_prefix                = var.name_prefix
  location                   = var.region
  resource_group_name        = data.azurerm_resource_group.this.name
  container_app_principal_id = azurerm_user_assigned_identity.app.principal_id

  postgres_connection_string = module.database.connection_string
  postgres_admin_password    = module.database.admin_password
  storage_connection_string  = module.storage.primary_connection_string
  maps_primary_key           = module.maps.primary_access_key
  jwt_secret                 = random_password.jwt.result

  tags = var.tags
}

module "container_app" {
  source                  = "../../modules/container-app"
  name_prefix             = var.name_prefix
  location                = var.region
  resource_group_name     = data.azurerm_resource_group.this.name
  container_app_subnet_id = module.network.container_app_subnet_id

  user_assigned_identity_id        = azurerm_user_assigned_identity.app.id
  user_assigned_identity_client_id = azurerm_user_assigned_identity.app.client_id

  acr_login_server = module.acr.login_server
  container_image  = var.backend_image

  storage_account_name      = module.storage.storage_account_name
  storage_container_name    = module.storage.container_name
  openai_endpoint           = module.ai.foundry_endpoint
  openai_default_deployment = module.ai.gpt_4o_mini_deployment_name
  openai_high_deployment    = module.ai.gpt_4o_deployment_name

  kv_postgres_connection_string_id = module.keyvault.postgres_connection_string_secret_id
  kv_storage_connection_string_id  = module.keyvault.storage_connection_string_secret_id
  kv_maps_subscription_key_id      = module.keyvault.maps_subscription_key_secret_id
  kv_jwt_secret_id                 = module.keyvault.jwt_secret_secret_id

  tags = var.tags

  # Ensure KV secrets exist + MI has read role before the app references them.
  depends_on = [module.keyvault, module.acr]
}

# Grant the Container App's MI access to Foundry (Cognitive Services) for token-based auth.
resource "azurerm_role_assignment" "app_cogsvc_user" {
  scope                = module.ai.foundry_id
  role_definition_name = "Cognitive Services User"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}

# Grant the Container App's MI access to the Storage account for blob ops.
resource "azurerm_role_assignment" "app_blob_contributor" {
  scope                = module.storage.storage_account_id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_user_assigned_identity.app.principal_id
}
