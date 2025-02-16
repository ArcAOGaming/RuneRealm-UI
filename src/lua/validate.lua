
local validate = {}

function validate.validateRequest(msg, requiredTags)
    if not msg.From then
        return false, "Missing user ID"
    end
    for _, tag in ipairs(requiredTags) do
        if not msg.Tags[tag] then
            return false, "Missing " .. tag
        end
    end
    return true
end

return validate  