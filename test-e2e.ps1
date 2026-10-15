$health = Invoke-RestMethod -Uri "http://localhost:3000/api/health"
Write-Host "1. Health check: $($health.status), version=$($health.pricingConfigVersion)"

$products = Invoke-RestMethod -Uri "http://localhost:3000/api/products"
Write-Host "2. Products count: $($products.data.Count)"

$options = Invoke-RestMethod -Uri "http://localhost:3000/api/print-options?productId=books"
Write-Host "3. Print options for books: $($options.data.Count)"

$quoteBody = @{
    productId = "books"
    options = @{
        size = "a5-portrait"
        interior = "bw"
        paper = "natural-white"
        binding = "paperback"
    }
    quantity = 10
} | ConvertTo-Json -Depth 3

$quote = Invoke-RestMethod -Uri "http://localhost:3000/api/quotes" -Method Post -Body $quoteBody -ContentType "application/json"
Write-Host "4. Quote generated: ID=$($quote.id), total=$($quote.total) paise (INR $($quote.total / 100))"

$uploadBody = @{
    originalFilename = "my_book_artwork.pdf"
    mimeType = "application/pdf"
    sizeBytes = 14500000
    quoteId = $quote.id
} | ConvertTo-Json

$upload = Invoke-RestMethod -Uri "http://localhost:3000/api/demo/uploads" -Method Post -Body $uploadBody -ContentType "application/json"
Write-Host "5. Upload registered: fileId=$($upload.fileId), status=$($upload.status)"

$orderHeaders = @{
    "Authorization" = "Bearer demo-token"
    "Idempotency-Key" = "test_idem_" + [guid]::NewGuid().ToString()
}
$orderBody = @{ quoteId = $quote.id } | ConvertTo-Json

$order = Invoke-RestMethod -Uri "http://localhost:3000/api/orders" -Method Post -Headers $orderHeaders -Body $orderBody -ContentType "application/json"
Write-Host "6. Order created: ID=$($order.id), status=$($order.status)"

$checkoutBody = @{
    orderId = $order.id
    paymentMethod = "demo_upi"
} | ConvertTo-Json

$checkout = Invoke-RestMethod -Uri "http://localhost:3000/api/demo/checkout" -Method Post -Body $checkoutBody -ContentType "application/json"
Write-Host "7. Demo checkout: txId=$($checkout.transactionId), status=$($checkout.status)"

$fetchedOrder = Invoke-RestMethod -Uri "http://localhost:3000/api/orders/$($order.id)" -Headers @{ "Authorization" = "Bearer demo-token" }
Write-Host "8. Order tracked: status=$($fetchedOrder.order.status), historyCount=$($fetchedOrder.history.Count)"
