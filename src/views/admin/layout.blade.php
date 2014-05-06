<!DOCTYPE html>
<html lang="en">
<head>
	<title>@yield('title') | Wardrobe</title>
	<meta name="env" content="{{ App::environment() }}">
	<meta name="token" content="{{ Session::token() }}">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href='http://fonts.googleapis.com/css?family=Lato:300,400,700' rel='stylesheet' type='text/css'>
	<link rel="stylesheet" type="text/css" href="{{ asset(wardrobe_path('admin/css/style.css')) }}">
	<link rel="stylesheet" href="http://cdn.oesmith.co.uk/morris-0.4.3.min.css">
</head>
<body>
<div id="header-region" class="header"></div>
<div class="container">
	<div class="row">
		<div class="col-md-12">
			<div id="js-alert"></div>
			<div id="js-errors" class="hide alert alert-danger">
				<button type="button" class="close" data-dismiss="alert" aria-hidden="true">&times;</button>
				<span></span>
			</div>
		</div>

		@yield('content')

	</div>
</div>
<script src="//ajax.googleapis.com/ajax/libs/jquery/1.11.0/jquery.min.js"></script>
<script>window.jQuery || document.write('<script src="{{ asset(wardrobe_path('admin/js/jquery.js')) }} "><\/script>')</script>
<script src="//cdnjs.cloudflare.com/ajax/libs/raphael/2.1.0/raphael-min.js"></script>
<script src="http://cdn.oesmith.co.uk/morris-0.4.3.min.js"></script>
<script type="text/javascript" src="{{ asset(wardrobe_path('admin/js/structure.js')) }}"></script>
<script type="text/javascript" src="{{ asset(wardrobe_path('admin/js/app.js')) }}"></script>
@yield('footer.js')
</body>
</html>
