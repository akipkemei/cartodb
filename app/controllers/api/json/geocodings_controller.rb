#encoding: UTF-8
class Api::Json::GeocodingsController < Api::ApplicationController
  ssl_required :index, :show, :create, :update

  def index
    geocodings = Geocoding.where("user_id = ? AND (state NOT IN ?)", current_user.id, ['failed', 'finished', 'cancelled'])
    render json: { geocodings: geocodings }
  end

  def show
    geocoding = current_user.geocodings_dataset.where(id: params[:id]).first
    raise RecordNotFound unless geocoding
    render json: geocoding
  end

  def update
    geocoding = current_user.geocodings_dataset.where(id: params[:id]).first
    return head(401) unless geocoding && params[:state] == 'cancelled'
    geocoding.update(state: 'cancelled')
    render_jsonp(geocoding.reload)
  rescue => e
    render_jsonp({ errors: e.message }, 400)
  end

  def create
    table = current_user.tables.where(name: params[:table_name]).first
    options = { 
      user_id:     current_user.id,
      table_id:    table.try(:id),
      formatter:   params[:formatter].presence
    }
      
    geocoding = Geocoding.create(options)
    table.automatic_geocoding.destroy if table.automatic_geocoding.present?
    Resque.enqueue(Resque::GeocoderJobs, job_id: geocoding.id)

    render_jsonp(geocoding.to_json)
  rescue Sequel::ValidationFailed => e
    render_jsonp( { description: e.message }, 422)
  end
end
