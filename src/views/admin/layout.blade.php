<!doctype html>
<html>
<head>
	<meta charset="utf-8">
    <title>@yield('title') | Wardrobe</title>
    <meta name="env" content="{{ App::environment() }}">
    <meta name="token" content="{{ Session::token() }}">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<link rel="stylesheet" type="text/css" href="/packages/wardrobe/cabinet/css/style.css">
	<link href="//netdna.bootstrapcdn.com/font-awesome/4.0.3/css/font-awesome.css" rel="stylesheet">
</head>
<body>

	<nav>
		<ul>
			<li><a class="write" href="{{ URL::route('wardrobe.post.create') }} "><i class="fa fa-plus"></i> {{ Lang::get('cabinet::wardrobe.write') }}</a></li>
			<li><a class="write" href="{{ URL::route('wardrobe.post.index') }} "><i class="fa fa-list"></i> {{ Lang::get('cabinet::wardrobe.posts') }}</a></li>
			<li><a class="accounts" href="#accounts"><i class="fa fa-user"></i> {{ Lang::get('cabinet::wardrobe.accounts') }}</a></li>
			<li><a href="{{ URL::route('wardrobe.admin.logout') }}"><i class="fa fa-power-off"></i> {{ Lang::get('cabinet::wardrobe.logout') }}</a></li>
		</ul>
	</nav>

	@include('cabinet::admin.inc.errors')

	<div class="container">
		@yield('content')
	</div>


  <script src="//ajax.googleapis.com/ajax/libs/jquery/1.9.1/jquery.min.js"></script>
  @yield('footer.js')
</body>
</html>
